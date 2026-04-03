import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload } from './jwt';

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
export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'No authorization header provided',
    });
    return;
  }

  // Check for Bearer token format
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid authorization header format. Use: Bearer <token>',
    });
    return;
  }

  const token = parts[1];

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid token';
    res.status(401).json({
      error: 'Unauthorized',
      message,
    });
  }
}

/**
 * Optional authentication middleware
 * Attaches user to request if valid token provided, but doesn't require it
 */
export function optionalAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    next();
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    next();
    return;
  }

  const token = parts[1];

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
