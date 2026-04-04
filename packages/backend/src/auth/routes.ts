import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { generateTokenPair, verifyToken, TokenPayload, DecodedRefreshToken } from './jwt';
import { authenticate, AuthenticatedRequest } from './middleware';
import {
  storeRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  getUserActiveTokens,
} from '../redis/client';
import { InputSanitizer } from '../audit';
import { randomUUID as crypto_randomUUID } from 'crypto';

const router: Router = Router();

// In-memory user store (replace with database in production)
interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  createdAt: Date;
}

const users: Map<string, User> = new Map();

/**
 * POST /auth/register
 * Register a new user
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    // Sanitize inputs
    const { email: rawEmail, password, role = 'user' } = req.body;
    const email = InputSanitizer.sanitizeEmail(rawEmail);
    const sanitizedPassword = InputSanitizer.sanitizeText(password, { maxLength: 100 });
    const sanitizedRole = InputSanitizer.sanitizeText(role, { maxLength: 50 });

    // Validate input
    if (!email || !sanitizedPassword) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Email and password are required',
      });
      return;
    }

    // Validate password strength
    if (sanitizedPassword.length < 8) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Password must be at least 8 characters long',
      });
      return;
    }

    // Check if user already exists
    if (users.has(email)) {
      res.status(409).json({
        error: 'Conflict',
        message: 'User with this email already exists',
      });
      return;
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(sanitizedPassword, salt);

    // Create user
    const user: User = {
      id: crypto_randomUUID(),
      email,
      passwordHash,
      role: sanitizedRole,
      createdAt: new Date(),
    };

    users.set(email, user);

    // Generate tokens
    const payload: TokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    const { accessToken, refreshToken, tokenId } = generateTokenPair(payload);

    // Store refresh token in Redis with 7 days TTL
    await storeRefreshToken(user.id, tokenId, 7 * 24 * 60 * 60);

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
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
    // Sanitize inputs
    const { email: rawEmail, password: rawPassword } = req.body;
    const email = InputSanitizer.sanitizeEmail(rawEmail);
    const password = InputSanitizer.sanitizeText(rawPassword, { maxLength: 100 });

    // Validate input
    if (!email || !password) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Email and password are required',
      });
      return;
    }

    // Find user
    const user = users.get(email);
    if (!user) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
      return;
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
      return;
    }

    // Generate tokens
    const payload: TokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    const { accessToken, refreshToken, tokenId } = generateTokenPair(payload);

    // Store refresh token in Redis with 7 days TTL
    await storeRefreshToken(user.id, tokenId, 7 * 24 * 60 * 60);

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
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
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Refresh token cookie is required',
      });
      return;
    }

    const cookies = Object.fromEntries(
      cookieHeader.split(';').map((c) => {
        const [k, ...v] = c.trim().split('=');
        return [decodeURIComponent(k), decodeURIComponent(v.join('='))];
      })
    ) as Record<string, string>;

    const refreshToken = cookies.refreshToken;
    if (!refreshToken) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Refresh token cookie is required',
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
    };

    const {
      accessToken,
      refreshToken: newRefreshToken,
      tokenId: newTokenId,
    } = generateTokenPair(payload);

    await revokeRefreshToken(decoded.tokenId);
    await storeRefreshToken(decoded.userId, newTokenId, 7 * 24 * 60 * 60);

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    };

    res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
    res.cookie('refreshToken', newRefreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      message: 'Tokens refreshed successfully',
      user: { userId: payload.userId, email: payload.email, role: payload.role },
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
router.get('/me', authenticate as any, (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Not authenticated',
    });
    return;
  }

  const user = users.get(req.user.email);
  if (!user) {
    res.status(404).json({
      error: 'Not Found',
      message: 'User not found',
    });
    return;
  }

  res.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    },
  });
});

/**
 * POST /auth/logout
 * Logout user by revoking refresh token
 */
router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  try {
    const cookieHeader = req.headers.cookie;
    let refreshToken: string | undefined;

    if (cookieHeader) {
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

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
      maxAge: 0,
    };

    res.cookie('accessToken', '', cookieOptions);
    res.cookie('refreshToken', '', cookieOptions);

    res.json({
      message: 'Logged out successfully',
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.cookie('accessToken', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    res.cookie('refreshToken', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
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
