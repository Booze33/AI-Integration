/**
 * Container Security Hardening Utilities
 *
 * - Runtime security checks
 * - Vulnerability scanning helpers
 * - Security headers
 * - Input validation
 * - Rate limiting and DDoS protection
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Security check results
 */
export interface SecurityCheckResult {
  passed: boolean;
  checks: Map<string, boolean>;
  warnings: string[];
  errors: string[];
}

/**
 * Runtime environment security checks
 */
export function performSecurityChecks(): SecurityCheckResult {
  const result: SecurityCheckResult = {
    passed: true,
    checks: new Map(),
    warnings: [],
    errors: [],
  };

  // Check 1: Running as non-root
  const uid = process.getuid?.();
  if (uid === 0) {
    result.checks.set('not-running-as-root', false);
    result.errors.push('❌ Running as root (UID 0). Containers should run as non-root user.');
    result.passed = false;
  } else {
    result.checks.set('not-running-as-root', true);
  }

  // Check 2: Node environment set
  if (process.env.NODE_ENV !== 'production') {
    result.checks.set('node-env-production', false);
    result.warnings.push(`⚠️  NODE_ENV is ${process.env.NODE_ENV}, not 'production'`);
  } else {
    result.checks.set('node-env-production', true);
  }

  // Check 3: Required security headers configured
  const requiredEnvVars = [
    'JWT_PRIVATE_KEY',
    'JWT_PUBLIC_KEY',
    'TENANT_CONFIG_ENCRYPTION_KEY',
    'DATABASE_URL',
    'REDIS_URL',
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      result.checks.set(`env-${envVar.toLowerCase()}`, false);
      result.errors.push(`❌ Missing required environment variable: ${envVar}`);
      result.passed = false;
    } else {
      result.checks.set(`env-${envVar.toLowerCase()}`, true);
    }
  }

  // Check 4: Memory limits
  if (process.env.MEMORY_LIMIT_MB) {
    const limitMB = parseInt(process.env.MEMORY_LIMIT_MB);
    const usedMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

    if (usedMB > limitMB * 0.9) {
      result.warnings.push(
        `⚠️  Memory usage is ${usedMB}MB/${limitMB}MB (${((usedMB / limitMB) * 100).toFixed(1)}%)`
      );
    } else {
      result.checks.set('memory-within-limits', true);
    }
  }

  if (result.errors.length > 0) {
    console.error('🔒 Security Check Results:');
    result.errors.forEach((e) => console.error(e));
  }

  if (result.warnings.length > 0) {
    console.warn('🔒 Security Warnings:');
    result.warnings.forEach((w) => console.warn(w));
  }

  if (result.passed) {
    console.log('✅ All security checks passed');
  }

  return result;
}

/**
 * Security headers middleware
 */
export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction) {
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Enable XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Clickjacking protection
  res.setHeader('X-Frame-Options', 'DENY');

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // CSP header (strict policy)
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'"
  );

  // HSTS (HTTPS only) - only in production
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // Disable caching for sensitive content
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  next();
}

/**
 * Input validation and sanitization
 */
export function sanitizeInput(input: any): any {
  if (typeof input === 'string') {
    // Remove potential XSS vectors
    return input
      .replace(/[<>]/g, '') // Remove angle brackets
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+\s*=/gi, ''); // Remove event handlers
  }

  if (typeof input === 'object' && input !== null) {
    if (Array.isArray(input)) {
      return input.map((item) => sanitizeInput(item));
    } else {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(input)) {
        sanitized[sanitizeInput(key)] = sanitizeInput(value);
      }
      return sanitized;
    }
  }

  return input;
}

/**
 * SQL injection detection
 */
export function detectSQLInjection(input: string): boolean {
  const sqlPatterns = [
    /(\bunion\b.*\bselect\b)/gi,
    /(\bor\b.*=.*)/gi,
    /(\bdrop\b.*\b)/gi,
    /(\bdelete\b.*\bfrom\b)/gi,
    /(\binsert\b.*\binto\b)/gi,
    /(\bupdate\b.*\bset\b)/gi,
    /(\balter\b.*\btable\b)/gi,
    /(\bexec\b.*\()/gi,
    /(\bexecute\b.*\()/gi,
    /(--|#|\/\*|\*\/)/gi, // SQL comments
  ];

  return sqlPatterns.some((pattern) => pattern.test(input));
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  windowMs: number; // Time window in ms
  maxRequests: number; // Max requests per window
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

/**
 * Simple in-memory rate limiter
 */
export class RateLimiter {
  private requestCounts: Map<string, { count: number; resetTime: number }> = new Map();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * Check if request should be allowed
   */
  isAllowed(key: string): boolean {
    const now = Date.now();
    const record = this.requestCounts.get(key);

    if (!record || now > record.resetTime) {
      // New window
      this.requestCounts.set(key, {
        count: 1,
        resetTime: now + this.config.windowMs,
      });
      return true;
    }

    record.count++;

    if (record.count > this.config.maxRequests) {
      return false;
    }

    return true;
  }

  /**
   * Get remaining requests
   */
  getRemaining(key: string): number {
    const record = this.requestCounts.get(key);

    if (!record || Date.now() > record.resetTime) {
      return this.config.maxRequests;
    }

    return Math.max(0, this.config.maxRequests - record.count);
  }

  /**
   * Reset time for key
   */
  getResetTime(key: string): number {
    const record = this.requestCounts.get(key);
    return record?.resetTime || 0;
  }

  /**
   * Cleanup old entries
   */
  cleanup() {
    const now = Date.now();

    for (const [key, record] of this.requestCounts.entries()) {
      if (now > record.resetTime) {
        this.requestCounts.delete(key);
      }
    }
  }
}

/**
 * Rate limiting middleware
 */
export function createRateLimitMiddleware(limiter: RateLimiter, config: RateLimitConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = config.keyGenerator ? config.keyGenerator(req) : req.ip || 'unknown';
    const allowed = limiter.isAllowed(key);
    const remaining = limiter.getRemaining(key);
    const resetTime = limiter.getResetTime(key);

    res.setHeader('X-RateLimit-Limit', config.maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(resetTime / 1000));

    if (!allowed) {
      res.status(429).json({
        error: 'Too many requests',
        retryAfter: Math.ceil((resetTime - Date.now()) / 1000),
      });
      return;
    }

    next();
  };
}

/**
 * Check for insecure dependencies (helper)
 */
export async function checkInsecureDependencies(): Promise<{ vulnerable: number; safe: number }> {
  // This would typically call npm audit or similar
  // For now, just return a placeholder
  console.log('🔒 Run `npm audit` or `pnpm audit` to check for vulnerabilities');

  return {
    vulnerable: 0,
    safe: 0,
  };
}

/**
 * Generate security scan report
 */
export function generateSecurityReport(): {
  timestamp: Date;
  environment: string;
  checks: SecurityCheckResult;
  recommendations: string[];
} {
  const checks = performSecurityChecks();
  const recommendations: string[] = [];

  if (!checks.checks.get('not-running-as-root')) {
    recommendations.push('Run container with non-root user (USER directive in Dockerfile)');
  }

  if (!checks.checks.get('node-env-production')) {
    recommendations.push('Set NODE_ENV=production in production containers');
  }

  if (process.env.NODE_ENV !== 'production') {
    recommendations.push('Enable HTTPS/TLS in production');
    recommendations.push('Enable security headers in all responses');
  }

  recommendations.push('Regularly scan dependencies with `pnpm audit`');
  recommendations.push('Keep base image updated');
  recommendations.push('Use multi-stage builds for smaller image size');
  recommendations.push('Scan images with container security tools (Trivy, Snyk, etc.)');

  return {
    timestamp: new Date(),
    environment: process.env.NODE_ENV || 'development',
    checks,
    recommendations,
  };
}
