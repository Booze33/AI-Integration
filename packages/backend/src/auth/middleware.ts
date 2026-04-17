import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload, DecodedRefreshToken, generateTokenPair } from './jwt';
import { verifyRefreshToken, revokeRefreshToken, storeRefreshToken } from '../redis/client';

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  for (const pair of cookieHeader.split(';')) {
    const [rawKey, ...rawValue] = pair.trim().split('=');
    if (!rawKey) continue;
    const key = decodeURIComponent(rawKey.trim());
    const value = decodeURIComponent((rawValue || []).join('=').trim());
    if (key) {
      cookies[key] = value;
    }
  }

  return cookies;
}

export function setTokenCookies(res: Response, accessToken: string, refreshToken: string): void {
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
  const accessMaxAge = 15 * 60 * 1000;
  const refreshMaxAge = 7 * 24 * 60 * 60 * 1000;

  res.cookie('accessToken', accessToken, {
    ...cookieOptions,
    maxAge: accessMaxAge,
  });

  res.cookie('refreshToken', refreshToken, {
    ...cookieOptions,
    maxAge: refreshMaxAge,
  });
}

async function refreshUsingCookie(req: Request, res: Response): Promise<TokenPayload | null> {
  const cookies = parseCookies(req.headers.cookie);
  const refreshToken = cookies.refreshToken;

  if (!refreshToken) return null;

  let decoded: DecodedRefreshToken;
  try {
    decoded = verifyToken(refreshToken) as DecodedRefreshToken;
  } catch {
    return null;
  }

  const stored = await verifyRefreshToken(decoded.tokenId);
  if (!stored || stored !== decoded.userId) {
    return null;
  }

  const payload: TokenPayload = {
    userId: decoded.userId,
    email: decoded.email,
    role: decoded.role,
    tenantId: decoded.tenantId,
  };

  const { accessToken, refreshToken: newRefreshToken, tokenId } = generateTokenPair(payload);

  await revokeRefreshToken(decoded.tokenId);
  await storeRefreshToken(payload.userId, tokenId, 7 * 24 * 60 * 60);

  setTokenCookies(res, accessToken, newRefreshToken);

  return payload;
}

// Define role hierarchy and permissions
export enum Role {
  ADMIN = 'admin',
  MEMBER = 'member',
  VIEWER = 'viewer',
}

// Role hierarchy: admin > member > viewer
const ROLE_HIERARCHY: Record<Role, number> = {
  [Role.ADMIN]: 3,
  [Role.MEMBER]: 2,
  [Role.VIEWER]: 1,
};

// Extend Express Request to include user and tenant context
export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
  tenantId?: string;
}

/**
 * Authentication middleware
 * Verifies JWT token from Authorization header
 */
export async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  const cookies = parseCookies(req.headers.cookie);
  const token =
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : cookies.accessToken;

  if (token) {
    try {
      const decoded = verifyToken(token);
      req.user = decoded;
      return next();
    } catch (error) {
      // Attempt refresh if expired
      if ((error as any)?.name === 'TokenExpiredError') {
        const refreshed = await refreshUsingCookie(req, res);
        if (refreshed) {
          req.user = refreshed;
          return next();
        }
      }
      const message = error instanceof Error ? error.message : 'Invalid token';
      res.status(401).json({
        error: 'Unauthorized',
        message,
      });
      return;
    }
  }

  // Try cookie refresh path as fallback
  const refreshed = await refreshUsingCookie(req, res);
  if (refreshed) {
    req.user = refreshed;
    return next();
  }

  res.status(401).json({
    error: 'Unauthorized',
    message: 'Authentication required',
  });
}

/**
 * Optional authentication middleware
 * Attaches user to request if valid token provided, but doesn't require it
 */
export function optionalAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const cookies = parseCookies(req.headers.cookie);
  const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : cookies.accessToken;

  if (!token) {
    next();
    return;
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
  } catch {
    // Token invalid, but continue without user
  }

  next();
}

/**
 * Role-based authorization middleware
 * Must be used after authenticate middleware
 *
 * @param roles - Allowed roles for the route
 */
export function requireRole(...roles: (Role | string)[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    if (!req.user.role) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'No role assigned to user',
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Forbidden',
        message: `Required role: ${roles.join(' or ')}`,
      });
      return;
    }

    next();
  };
}

/**
 * Require minimum role level (hierarchical)
 * Admin can access everything, Member can access Member + Viewer, Viewer only Viewer
 *
 * @param minimumRole - Minimum role required
 */
export function requireMinRole(minimumRole: Role) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    if (!req.user.role) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'No role assigned to user',
      });
      return;
    }

    const userRoleLevel = ROLE_HIERARCHY[req.user.role as Role] || 0;
    const requiredLevel = ROLE_HIERARCHY[minimumRole] || 0;

    if (userRoleLevel < requiredLevel) {
      res.status(403).json({
        error: 'Forbidden',
        message: `Requires ${minimumRole} role or higher`,
      });
      return;
    }

    next();
  };
}

/**
 * Admin only middleware
 * Shorthand for requireRole(Role.ADMIN)
 */
export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  return requireRole(Role.ADMIN)(req, res, next);
}

/**
 * Member or Admin middleware
 * Shorthand for requireMinRole(Role.MEMBER)
 */
export function requireMember(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  return requireMinRole(Role.MEMBER)(req, res, next);
}

/**
 * Any authenticated user (Viewer, Member, or Admin)
 * Shorthand for requireMinRole(Role.VIEWER)
 */
export function requireViewer(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  return requireMinRole(Role.VIEWER)(req, res, next);
}

/**
 * Check if user has specific permission
 * Useful for conditional logic in controllers
 */
export function hasRole(user: TokenPayload | undefined, ...roles: (Role | string)[]): boolean {
  if (!user || !user.role) return false;
  return roles.includes(user.role);
}

/**
 * Check if user meets minimum role level
 */
export function hasMinRole(user: TokenPayload | undefined, minimumRole: Role): boolean {
  if (!user || !user.role) return false;
  const userRoleLevel = ROLE_HIERARCHY[user.role as Role] || 0;
  const requiredLevel = ROLE_HIERARCHY[minimumRole] || 0;
  return userRoleLevel >= requiredLevel;
}

// ============================================================================
// Tenant Context Middleware
// ============================================================================

/**
 * Tenant context middleware
 * Ensures every authenticated request carries tenant_id
 * Must be used AFTER authenticate middleware
 *
 * @param options - Configuration options
 */
export function requireTenant(options?: { allowHeader?: boolean; allowQuery?: boolean }) {
  const { allowHeader = true, allowQuery = false } = options || {};

  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required before tenant validation',
      });
      return;
    }

    // Try to get tenant_id from JWT token first
    let tenantId = req.user.tenantId;

    // Fallback to header if allowed
    if (!tenantId && allowHeader) {
      tenantId = req.headers['x-tenant-id'] as string | undefined;
    }

    // Fallback to query parameter if allowed
    if (!tenantId && allowQuery) {
      tenantId = req.query.tenant_id as string | undefined;
    }

    if (!tenantId) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Tenant ID required. Provide via JWT token or x-tenant-id header',
      });
      return;
    }

    // Inject tenant_id into request for easy access in controllers
    req.tenantId = tenantId;

    next();
  };
}

/**
 * Optional tenant context middleware
 * Attaches tenant_id if available, but doesn't require it
 */
export function optionalTenant(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    next();
    return;
  }

  // Try to get tenant_id from JWT token
  let tenantId = req.user.tenantId;

  // Fallback to header
  if (!tenantId) {
    tenantId = req.headers['x-tenant-id'] as string | undefined;
  }

  // Fallback to query parameter
  if (!tenantId) {
    tenantId = req.query.tenant_id as string | undefined;
  }

  // Inject if found (but don't require)
  if (tenantId) {
    req.tenantId = tenantId;
  }

  next();
}

/**
 * Combined middleware: authenticate + requireTenant
 * Convenience middleware for routes that need both authentication and tenant context
 */
export function authenticateWithTenant(options?: { allowHeader?: boolean; allowQuery?: boolean }) {
  return [authenticate, requireTenant(options)];
}
