// JWT Authentication with RS256 (Asymmetric Keys)
export {
  generateAccessToken,
  generateRefreshToken,
  generateTokenPair,
  verifyToken,
  decodeToken,
  TokenPayload,
  RefreshTokenPayload,
  DecodedToken,
  DecodedRefreshToken,
} from './jwt';

export {
  // Types
  Role,
  AuthenticatedRequest,
  // Authentication middleware
  authenticate,
  optionalAuth,
  // Role-based middleware
  requireRole,
  requireMinRole,
  requireAdmin,
  requireMember,
  requireViewer,
  // Tenant context middleware
  requireTenant,
  optionalTenant,
  authenticateWithTenant,
  // Helper functions
  hasRole,
  hasMinRole,
} from './middleware';

export { authRoutes, setAuthPool } from './routes';
