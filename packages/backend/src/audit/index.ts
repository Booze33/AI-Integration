/**
 * Audit Module
 *
 * Exports audit logging, input sanitization, and environment validation utilities.
 */

export {
  AuditService,
  AuditEvent,
  getClientInfo,
  createAuditService,
  startAuditCleanupJob,
  AUDIT_CLEANUP_INTERVAL_MS,
} from './service';
export { InputSanitizer, InputValidator, ValidationRule, ValidationSchema } from './sanitizer';
export {
  validateEnv,
  getEnv,
  isProduction,
  isDevelopment,
  isTest,
  printEnvConfig,
  validateEnvVariable,
  type Environment,
} from './env';
export { logAudit, auditLogging, createAuditMiddleware } from './middleware';
