import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { TenantDatabase } from '../database/tenant-context';
import { generateTokenPair, verifyToken, TokenPayload, DecodedRefreshToken } from './jwt';
import { authenticate, AuthenticatedRequest, setTokenCookies } from './middleware';
import {
  storeRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  getUserActiveTokens,
} from '../redis/client';
import { InputSanitizer } from '../audit';

const router: Router = Router();

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000000';

let tenantDb: TenantDatabase | null = null;

export function setAuthPool(pool: Pool): void {
  tenantDb = TenantDatabase.fromPool(pool);
}

function getTenantDb(): TenantDatabase {
  if (!tenantDb) {
    throw new Error('Auth database pool has not been initialized');
  }
  return tenantDb;
}

interface DbUser {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

function resolveRequestedTenantId(req: Request): string | null {
  const tenantIdCandidate =
    typeof req.body?.tenantId === 'string'
      ? req.body.tenantId
      : typeof req.body?.tenant_id === 'string'
        ? req.body.tenant_id
        : typeof req.headers['x-tenant-id'] === 'string'
          ? req.headers['x-tenant-id']
          : null;

  if (!tenantIdCandidate) {
    return null;
  }

  const sanitizedTenantId = InputSanitizer.sanitizeText(tenantIdCandidate, {
    maxLength: 100,
  });

  return sanitizedTenantId || null;
}

async function findUserByEmail(email: string, tenantId?: string | null): Promise<DbUser | null> {
  if (tenantId) {
    return getTenantDb().withTenant(tenantId, async (client) => {
      const result = await client.query<DbUser>(
        'SELECT id, tenant_id, email, password_hash, created_at, updated_at FROM auth.users WHERE email = $1 AND deleted_at IS NULL',
        [email]
      );
      return result.rows[0] || null;
    });
  }

  const client = await getTenantDb().getRawConnection();
  try {
    const result = await client.query<DbUser>(
      `SELECT id, tenant_id, email, password_hash, created_at, updated_at
       FROM auth.users
       WHERE email = $1 AND deleted_at IS NULL
       ORDER BY created_at ASC
       LIMIT 1`,
      [email]
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

async function findUserById(userId: string, tenantId?: string | null): Promise<DbUser | null> {
  if (tenantId) {
    return getTenantDb().withTenant(tenantId, async (client) => {
      const result = await client.query<DbUser>(
        'SELECT id, tenant_id, email, password_hash, created_at, updated_at FROM auth.users WHERE id = $1 AND deleted_at IS NULL',
        [userId]
      );
      return result.rows[0] || null;
    });
  }

  const client = await getTenantDb().getRawConnection();
  try {
    const result = await client.query<DbUser>(
      `SELECT id, tenant_id, email, password_hash, created_at, updated_at
       FROM auth.users
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [userId]
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

async function getUserRole(tenantId: string, userId: string): Promise<string | null> {
  return getTenantDb().withTenant(tenantId, async (client) => {
    const result = await client.query<{ role: string }>(
      'SELECT role FROM auth.user_roles WHERE user_id = $1 AND tenant_id = $2 ORDER BY granted_at DESC LIMIT 1',
      [userId, tenantId]
    );
    return result.rows[0]?.role || null;
  });
}

async function createAuthUser(
  tenantId: string,
  email: string,
  passwordHash: string
): Promise<DbUser> {
  return getTenantDb().withTenant(tenantId, async (client) => {
    const result = await client.query<DbUser>(
      `INSERT INTO auth.users (
         tenant_id,
         email,
         password_hash,
         status,
         email_verified,
         metadata,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, 'active', false, '{}', NOW(), NOW())
       RETURNING id, tenant_id, email, password_hash, created_at, updated_at`,
      [tenantId, email, passwordHash]
    );
    return result.rows[0];
  });
}

async function assignRoleToUser(tenantId: string, userId: string, role: string): Promise<void> {
  await getTenantDb().withTenant(tenantId, async (client) => {
    await client.query(
      `INSERT INTO auth.user_roles (tenant_id, user_id, role, granted_by)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, userId, role, userId]
    );
  });
}

async function ensureRegistrationTenant(tenantId?: string | null): Promise<string> {
  if (tenantId) {
    return tenantId;
  }

  // Registration falls back to the shared default tenant when tenant is omitted.
  return DEFAULT_TENANT_ID;
}

function isValidEmailAddress(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * POST /auth/register
 * Register a new user
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email: rawEmail, password, role = 'member' } = req.body;
    const email = InputSanitizer.sanitizeEmail(rawEmail);
    const sanitizedPassword = InputSanitizer.sanitizeText(password, { maxLength: 100 });
    const sanitizedRole = InputSanitizer.sanitizeText(role, { maxLength: 50 });

    if (!email || !sanitizedPassword) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Email and password are required',
      });
      return;
    }

    if (!isValidEmailAddress(rawEmail)) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'A valid email address is required',
      });
      return;
    }

    if (sanitizedPassword.length < 8) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Password must be at least 8 characters long',
      });
      return;
    }

    const requestedTenantId = resolveRequestedTenantId(req);
    const existingUser = await findUserByEmail(email, requestedTenantId);
    if (existingUser) {
      res.status(409).json({
        error: 'Conflict',
        message: 'User with this email already exists',
      });
      return;
    }

    const tenantId = await ensureRegistrationTenant(requestedTenantId);

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(sanitizedPassword, salt);

    let user: DbUser;
    try {
      user = await createAuthUser(tenantId, email, passwordHash);
      await assignRoleToUser(tenantId, user.id, sanitizedRole);
    } catch (error: unknown) {
      const pgError = error as { code?: string };
      if (pgError.code === '23505') {
        res.status(409).json({
          error: 'Conflict',
          message: 'User with this email already exists',
        });
        return;
      }
      throw error;
    }

    const payload: TokenPayload = {
      userId: user.id,
      email: user.email,
      role: sanitizedRole,
      tenantId,
    };

    const { accessToken, refreshToken, tokenId } = generateTokenPair(payload);
    await storeRefreshToken(user.id, tokenId, 7 * 24 * 60 * 60);

    setTokenCookies(res, accessToken, refreshToken);

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        email: user.email,
        role: sanitizedRole,
        tenantId,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to register user',
    });
  }
});

/**
 * POST /auth/login
 * Authenticate user and return tokens
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email: rawEmail, password: rawPassword } = req.body;
    const email = InputSanitizer.sanitizeEmail(rawEmail);
    const password = InputSanitizer.sanitizeText(rawPassword, { maxLength: 100 });
    const requestedTenantId = resolveRequestedTenantId(req);

    if (!email || !password) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Email and password are required',
      });
      return;
    }

    const user = await findUserByEmail(email, requestedTenantId);
    if (!user || !user.password_hash) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
      return;
    }

    const tenantId = user.tenant_id || requestedTenantId || DEFAULT_TENANT_ID;
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
      return;
    }

    const persistedRole = (await getUserRole(tenantId, user.id)) || 'member';
    const payload: TokenPayload = {
      userId: user.id,
      email: user.email,
      role: persistedRole,
      tenantId,
    };

    const { accessToken, refreshToken, tokenId } = generateTokenPair(payload);
    await storeRefreshToken(user.id, tokenId, 7 * 24 * 60 * 60);

    setTokenCookies(res, accessToken, refreshToken);

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        role: persistedRole,
        tenantId,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to login',
    });
  }
});

/**
 * POST /auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const refreshTokenCandidate =
      typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null;
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader && !refreshTokenCandidate) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Refresh token is required',
      });
      return;
    }

    const cookies = cookieHeader
      ? (Object.fromEntries(
          cookieHeader.split(';').map((c) => {
            const [k, ...v] = c.trim().split('=');
            return [decodeURIComponent(k), decodeURIComponent(v.join('='))];
          })
        ) as Record<string, string>)
      : {};

    const refreshToken = refreshTokenCandidate || cookies.refreshToken;
    if (!refreshToken) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Refresh token is required',
      });
      return;
    }

    let decoded: DecodedRefreshToken;
    try {
      decoded = verifyToken(refreshToken) as DecodedRefreshToken;
    } catch {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid refresh token',
      });
      return;
    }

    const storedUserId = await verifyRefreshToken(decoded.tokenId);
    if (!storedUserId || storedUserId !== decoded.userId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Refresh token has been revoked or expired',
      });
      return;
    }

    const payload: TokenPayload = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      tenantId: decoded.tenantId,
    };

    const {
      accessToken,
      refreshToken: newRefreshToken,
      tokenId: newTokenId,
    } = generateTokenPair(payload);

    await revokeRefreshToken(decoded.tokenId);
    await storeRefreshToken(decoded.userId, newTokenId, 7 * 24 * 60 * 60);

    setTokenCookies(res, accessToken, newRefreshToken);

    res.json({
      message: 'Tokens refreshed successfully',
      user: {
        id: payload.userId,
        email: payload.email,
        role: payload.role,
        tenantId: payload.tenantId,
      },
      accessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid refresh token',
    });
  }
});

/**
 * GET /auth/me
 * Get current user info (protected route)
 */
router.get(
  '/me',
  authenticate as any,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Not authenticated',
      });
      return;
    }

    const tenantId = req.user.tenantId || DEFAULT_TENANT_ID;
    const user = await findUserById(req.user.userId, tenantId);

    if (!user) {
      res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
      return;
    }

    const role = req.user.role || (await getUserRole(tenantId, user.id)) || 'member';

    res.json({
      user: {
        id: user.id,
        email: user.email,
        role,
        tenantId,
        createdAt: user.created_at,
      },
    });
  }
);

/**
 * POST /auth/logout
 * Logout user by revoking refresh token
 */
router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  try {
    const cookieHeader = req.headers.cookie;
    let refreshToken: string | undefined =
      typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined;

    if (!refreshToken && cookieHeader) {
      const cookies = Object.fromEntries(
        cookieHeader.split(';').map((c) => {
          const [k, ...v] = c.trim().split('=');
          return [decodeURIComponent(k), decodeURIComponent(v.join('='))];
        })
      ) as Record<string, string>;
      refreshToken = cookies.refreshToken;
    }

    if (refreshToken) {
      try {
        const decoded = verifyToken(refreshToken) as DecodedRefreshToken;
        await revokeRefreshToken(decoded.tokenId);
      } catch {
        // Token invalid, but still return success
      }
    }

    res.clearCookie('accessToken', { path: '/' });
    res.clearCookie('refreshToken', { path: '/' });

    res.json({
      message: 'Logged out successfully',
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.json({
      message: 'Logged out successfully',
    });
  }
});

/**
 * POST /auth/logout-all
 * Logout from all devices by revoking all refresh tokens for user
 */
router.post(
  '/logout-all',
  authenticate as any,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Not authenticated',
        });
        return;
      }

      await revokeAllUserTokens(req.user.userId);

      res.json({
        message: 'Logged out from all devices successfully',
      });
    } catch (error) {
      console.error('Logout all error:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to logout from all devices',
      });
    }
  }
);

/**
 * GET /auth/tokens
 * Get all active refresh tokens for current user
 */
router.get(
  '/tokens',
  authenticate as any,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Not authenticated',
        });
        return;
      }

      const activeTokens = await getUserActiveTokens(req.user.userId);

      res.json({
        activeTokenCount: activeTokens.length,
        tokens: activeTokens,
      });
    } catch (error) {
      console.error('Get tokens error:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to get active tokens',
      });
    }
  }
);

/**
 * DELETE /auth/tokens/:tokenId
 * Revoke a specific refresh token
 */
router.delete(
  '/tokens/:tokenId',
  authenticate as any,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Not authenticated',
        });
        return;
      }

      const { tokenId } = req.params;

      // Verify token belongs to user before revoking
      const storedUserId = await verifyRefreshToken(tokenId);
      if (storedUserId && storedUserId !== req.user.userId) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Cannot revoke token belonging to another user',
        });
        return;
      }

      await revokeRefreshToken(tokenId);

      res.json({
        message: 'Token revoked successfully',
      });
    } catch (error) {
      console.error('Revoke token error:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to revoke token',
      });
    }
  }
);

export { router as authRoutes };
