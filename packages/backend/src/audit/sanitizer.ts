/**
 * Input Sanitization Service
 *
 * Sanitizes user inputs to prevent XSS, injection attacks, and other security issues.
 * Validates and cleans data before processing.
 */

import * as crypto from 'crypto';

export class InputSanitizer {
  /**
   * Sanitize HTML content to prevent XSS attacks
   */
  static sanitizeHtml(input: string, options: { maxLength?: number } = {}): string {
    if (typeof input !== 'string') {
      return '';
    }

    const maxLength = options.maxLength || 10000;
    let sanitized = input.slice(0, maxLength);

    // Remove script tags and event handlers
    sanitized = sanitized
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
      .replace(/on\w+\s*=\s*[^\s>]*/gi, '');

    // Remove dangerous tags
    sanitized = sanitized
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/<embed\b[^<]*>/gi, '')
      .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');

    // Remove javascript: protocol
    sanitized = sanitized.replace(/javascript:/gi, '');

    // Remove data: protocol for images
    sanitized = sanitized.replace(/data:text\/html/gi, '');

    return sanitized;
  }

  /**
   * Sanitize plain text to prevent injection attacks
   */
  static sanitizeText(
    input: string,
    options: { maxLength?: number; allowNewlines?: boolean } = {}
  ): string {
    if (typeof input !== 'string') {
      return '';
    }

    const maxLength = options.maxLength || 1000;
    const allowNewlines = options.allowNewlines ?? true;

    const sanitized = input
      .slice(0, maxLength)
      .trim()
      .split('')
      .filter((char) => {
        const code = char.charCodeAt(0);
        if (allowNewlines && (code === 10 || code === 13)) {
          return true;
        }
        return code >= 0x20 && code !== 0x7f;
      })
      .join('');

    return sanitized;
  }

  /**
   * Sanitize email address
   */
  static sanitizeEmail(input: string): string {
    if (typeof input !== 'string') {
      return '';
    }

    const email = input.toLowerCase().trim();

    // Basic email validation and sanitization
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return '';
    }

    return email;
  }

  /**
   * Sanitize URL
   */
  static sanitizeUrl(input: string): string {
    if (typeof input !== 'string') {
      return '';
    }

    const url = input.trim();

    // Only allow http, https, and relative URLs
    if (!/^(https?:\/\/|\/|\.\/|\.\.\/)/i.test(url)) {
      return '';
    }

    // Remove javascript: and data: protocols
    if (/^javascript:|^data:/i.test(url)) {
      return '';
    }

    try {
      // Validate URL format
      new URL(url, 'http://example.com');
      return url;
    } catch {
      return '';
    }
  }

  /**
   * Sanitize filename to prevent directory traversal
   */
  static sanitizeFilename(input: string, options: { maxLength?: number } = {}): string {
    if (typeof input !== 'string') {
      return '';
    }

    const maxLength = options.maxLength || 255;
    let filename = input.slice(0, maxLength).trim();

    // Remove path traversal attempts
    filename = filename.replace(/\.\./g, '').replace(/[/\\]/g, '');

    // Replace unsafe characters
    filename = filename.replace(/[<>:"|?*]/g, '_');
    filename = filename
      .split('')
      .map((char) => {
        const code = char.charCodeAt(0);
        return code >= 0x20 ? char : '_';
      })
      .join('');

    // Ensure file has an extension and name
    if (!filename.includes('.')) {
      filename = `file_${Date.now()}`;
    }

    return filename;
  }

  /**
   * Sanitize JSON object (deeply sanitize string values)
   */
  static sanitizeObject(
    obj: any,
    options: { sanitizeHtml?: boolean; maxDepth?: number } = {}
  ): any {
    if (options.maxDepth === 0) {
      return obj;
    }

    const maxDepth = options.maxDepth ?? 10;
    const sanitizeHtml = options.sanitizeHtml ?? true;

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeObject(item, { ...options, maxDepth: maxDepth - 1 }));
    }

    if (obj !== null && typeof obj === 'object') {
      const sanitized: any = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          const sanitizedKey = this.sanitizeText(key, { maxLength: 100 });
          sanitized[sanitizedKey] = this.sanitizeObject(obj[key], {
            ...options,
            maxDepth: maxDepth - 1,
          });
        }
      }
      return sanitized;
    }

    if (typeof obj === 'string') {
      return sanitizeHtml ? this.sanitizeHtml(obj) : this.sanitizeText(obj);
    }

    if (typeof obj === 'number' || typeof obj === 'boolean') {
      return obj;
    }

    return null;
  }

  /**
   * Validate and sanitize UUID
   */
  static sanitizeUuid(input: string): string | null {
    if (typeof input !== 'string') {
      return null;
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(input)) {
      return null;
    }

    return input.toLowerCase();
  }

  /**
   * Validate and sanitize integer
   */
  static sanitizeInteger(input: any, options: { min?: number; max?: number } = {}): number | null {
    const num = parseInt(input, 10);

    if (isNaN(num)) {
      return null;
    }

    if (options.min !== undefined && num < options.min) {
      return null;
    }

    if (options.max !== undefined && num > options.max) {
      return null;
    }

    return num;
  }

  /**
   * Escape SQL-like strings (for safer logging, not a replacement for parameterized queries)
   */
  static escapeSqlLike(input: string): string {
    if (typeof input !== 'string') {
      return '';
    }

    return input.replace(/'/g, "''").replace(/\\/g, '\\\\');
  }

  /**
   * Hash sensitive string (for logging without exposing data)
   */
  static hashSensitive(input: string): string {
    if (typeof input !== 'string') {
      return '';
    }

    return crypto.createHash('sha256').update(input).digest('hex').slice(0, 8);
  }
}

/**
 * Type-safe input validation
 */
export interface ValidationRule {
  type: 'string' | 'email' | 'url' | 'uuid' | 'integer' | 'boolean';
  required?: boolean;
  maxLength?: number;
  minLength?: number;
  pattern?: RegExp;
  sanitize?: boolean;
}

export interface ValidationSchema {
  [key: string]: ValidationRule;
}

export class InputValidator {
  static validate(
    data: any,
    schema: ValidationSchema
  ): { valid: boolean; errors: Record<string, string>; data: any } {
    const errors: Record<string, string> = {};
    const validatedData: any = {};

    for (const key in schema) {
      if (Object.prototype.hasOwnProperty.call(schema, key)) {
        const rule = schema[key];
        const value = data?.[key];

        // Check required
        if (rule.required && (value === undefined || value === null || value === '')) {
          errors[key] = `${key} is required`;
          continue;
        }

        if (value === undefined || value === null) {
          validatedData[key] = null;
          continue;
        }

        // Validate by type
        try {
          switch (rule.type) {
            case 'string':
              if (typeof value !== 'string') {
                errors[key] = `${key} must be a string`;
                break;
              }

              if (rule.minLength && value.length < rule.minLength) {
                errors[key] = `${key} must be at least ${rule.minLength} characters`;
                break;
              }

              if (rule.maxLength && value.length > rule.maxLength) {
                errors[key] = `${key} must be at most ${rule.maxLength} characters`;
                break;
              }

              if (rule.pattern && !rule.pattern.test(value)) {
                errors[key] = `${key} format is invalid`;
                break;
              }

              validatedData[key] = rule.sanitize
                ? InputSanitizer.sanitizeText(value, { maxLength: rule.maxLength })
                : value;
              break;

            case 'email': {
              const sanitizedEmail = InputSanitizer.sanitizeEmail(value);
              if (!sanitizedEmail) {
                errors[key] = `${key} is not a valid email`;
              } else {
                validatedData[key] = sanitizedEmail;
              }
              break;
            }

            case 'url': {
              const sanitizedUrl = InputSanitizer.sanitizeUrl(value);
              if (!sanitizedUrl) {
                errors[key] = `${key} is not a valid URL`;
              } else {
                validatedData[key] = sanitizedUrl;
              }
              break;
            }

            case 'uuid': {
              const sanitizedUuid = InputSanitizer.sanitizeUuid(value);
              if (!sanitizedUuid) {
                errors[key] = `${key} is not a valid UUID`;
              } else {
                validatedData[key] = sanitizedUuid;
              }
              break;
            }

            case 'integer': {
              const sanitizedInt = InputSanitizer.sanitizeInteger(value);
              if (sanitizedInt === null) {
                errors[key] = `${key} must be an integer`;
              } else {
                validatedData[key] = sanitizedInt;
              }
              break;
            }

            case 'boolean':
              if (typeof value !== 'boolean') {
                errors[key] = `${key} must be a boolean`;
              } else {
                validatedData[key] = value;
              }
              break;
          }
        } catch {
          errors[key] = `${key} validation failed`;
        }
      }
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      data: validatedData,
    };
  }
}
