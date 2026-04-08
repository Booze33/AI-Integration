/**
 * Tenant AI Configuration Routes
 *
 * API endpoints for managing per-tenant AI provider configurations.
 * Requires authentication and tenant context.
 */

import { Router } from 'express';
import { Pool } from 'pg';
import { body, param, validationResult } from 'express-validator';
import { authenticate, requireRole, AuthenticatedRequest } from '../auth/middleware';
import { TenantAIConfigService } from './tenant-config';
import { PostgreSQLTenantAIConfigRepository } from './postgres-repository';
import { ProviderName } from './types';
import { Request, Response } from 'express';
import { logAudit, InputSanitizer } from '../audit';

// Create service instance with encryption key from environment and PostgreSQL repository
const encryptionKey =
  process.env.TENANT_CONFIG_ENCRYPTION_KEY || 'default-encryption-key-for-development';
let tenantConfigService: TenantAIConfigService | null = null;

function getTenantConfigService(): TenantAIConfigService {
  if (!tenantConfigService) {
    throw new Error('Tenant config service has not been initialized');
  }
  return tenantConfigService;
}

export function setTenantConfigPool(pool: Pool): void {
  const repository = new PostgreSQLTenantAIConfigRepository(pool);
  tenantConfigService = new TenantAIConfigService(encryptionKey, repository);
}

export function setTenantConfigService(service: TenantAIConfigService): void {
  tenantConfigService = service;
}

const router: Router = Router();

// All routes require authentication
router.use(authenticate);

// Get all active AI configurations for the current tenant
router.get(
  '/config',
  authenticate,
  requireRole('admin', 'owner'),
  async (req: Request, res: Response) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const tenantId = authReq.tenantId!;
      const configs = await getTenantConfigService().findActiveByTenant(tenantId);

      // Mask API keys in response
      const maskedConfigs = configs.map((config) => ({
        ...config,
        api_key_encrypted: '••••••••••••••••', // Masked for security
      }));

      res.json({
        success: true,
        data: maskedConfigs,
      });
    } catch (error) {
      console.error('Error fetching configurations:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch configurations',
      });
    }
  }
);

// Get a specific AI configuration by ID
router.get(
  '/config/:id',
  authenticate,
  requireRole('admin', 'owner'),
  param('id').isUUID(),
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { id } = req.params;
      const authReq = req as AuthenticatedRequest;
      const tenantId = authReq.tenantId!;

      const config = await getTenantConfigService().findById(id);
      if (!config || config.tenant_id !== tenantId) {
        return res.status(404).json({
          success: false,
          error: 'Configuration not found',
        });
      }

      // Mask API key in response
      const maskedConfig = {
        ...config,
        api_key_encrypted: '••••••••••••••••',
      };

      res.json({
        success: true,
        data: maskedConfig,
      });
    } catch (error) {
      console.error('Error fetching configuration:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch configuration',
      });
    }
  }
);

// Create a new AI configuration
router.post(
  '/config',
  authenticate,
  requireRole('admin', 'owner'),
  [
    body('provider').isIn([
      'openai',
      'anthropic',
      'deepgram',
      'elevenlabs',
      'azure-openai',
      'google',
      'mistral',
      'groq',
      'ollama',
      'custom',
    ]),
    body('api_key').isLength({ min: 1 }),
    body('base_url').optional().isURL(),
    body('organization').optional().isLength({ max: 255 }),
    body('default_model').optional().isLength({ max: 100 }),
    body('default_voice_id').optional().isLength({ max: 100 }),
    body('timeout_ms').optional().isInt({ min: 1000, max: 300000 }),
    body('max_retries').optional().isInt({ min: 0, max: 10 }),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const authReq = req as AuthenticatedRequest;
      const tenantId = authReq.tenantId!;
      const userId = authReq.user!.userId;
      const input = req.body;

      // Sanitize inputs
      const sanitizedInput = {
        provider: InputSanitizer.sanitizeText(input.provider, { maxLength: 50 }),
        api_key: InputSanitizer.sanitizeText(input.api_key, { maxLength: 1000 }),
        base_url: input.base_url ? InputSanitizer.sanitizeUrl(input.base_url) : undefined,
        organization: input.organization
          ? InputSanitizer.sanitizeText(input.organization, { maxLength: 255 })
          : undefined,
        default_model: input.default_model
          ? InputSanitizer.sanitizeText(input.default_model, { maxLength: 100 })
          : undefined,
        default_voice_id: input.default_voice_id
          ? InputSanitizer.sanitizeText(input.default_voice_id, { maxLength: 100 })
          : undefined,
        timeout_ms: input.timeout_ms
          ? InputSanitizer.sanitizeInteger(input.timeout_ms, { min: 1000, max: 300000 })
          : undefined,
        max_retries: input.max_retries
          ? InputSanitizer.sanitizeInteger(input.max_retries, { min: 0, max: 10 })
          : undefined,
      };

      // Check if configuration already exists for this provider
      const existing = await getTenantConfigService().findByTenantAndProvider(
        tenantId,
        sanitizedInput.provider as ProviderName
      );

      if (existing) {
        // Log failed creation attempt
        await logAudit(req.auditService, {
          tenantId,
          userId,
          action: 'CREATE_CONFIG',
          resource: 'TENANT_AI_CONFIG',
          ipAddress: req.clientInfo?.ipAddress || 'unknown',
          userAgent: req.clientInfo?.userAgent || 'unknown',
          statusCode: 409,
          errorMessage: `Configuration already exists for provider: ${sanitizedInput.provider}`,
        });

        return res.status(409).json({
          success: false,
          error: `Configuration already exists for provider: ${sanitizedInput.provider}`,
        });
      }

      const config = await getTenantConfigService().create(tenantId, sanitizedInput as any, userId);

      // Log successful creation
      await logAudit(req.auditService, {
        tenantId,
        userId,
        action: 'CREATE_CONFIG',
        resource: 'TENANT_AI_CONFIG',
        resourceId: config.id,
        changes: {
          provider: config.provider,
          base_url: config.base_url,
          organization: config.organization,
          default_model: config.default_model,
        },
        ipAddress: req.clientInfo?.ipAddress || 'unknown',
        userAgent: req.clientInfo?.userAgent || 'unknown',
        statusCode: 201,
      });

      // Mask API key in response
      const maskedConfig = {
        ...config,
        api_key_encrypted: '••••••••••••••••',
      };

      res.status(201).json({
        success: true,
        data: maskedConfig,
      });
    } catch (error) {
      const authReq = req as AuthenticatedRequest;
      // Log error
      await logAudit(req.auditService, {
        tenantId: authReq.tenantId || 'unknown',
        userId: authReq.user?.userId || 'unknown',
        action: 'CREATE_CONFIG',
        resource: 'TENANT_AI_CONFIG',
        ipAddress: req.clientInfo?.ipAddress || 'unknown',
        userAgent: req.clientInfo?.userAgent || 'unknown',
        statusCode: 500,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      console.error('Error creating configuration:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create configuration',
      });
    }
  }
);

// Update an existing AI configuration
router.put(
  '/config/:id',
  authenticate,
  requireRole('admin', 'owner'),
  [
    param('id').isUUID(),
    body('provider')
      .optional()
      .isIn([
        'openai',
        'anthropic',
        'deepgram',
        'elevenlabs',
        'azure-openai',
        'google',
        'mistral',
        'groq',
        'ollama',
        'custom',
      ]),
    body('api_key').optional().isLength({ min: 1 }),
    body('base_url').optional().isURL(),
    body('organization').optional().isLength({ max: 255 }),
    body('default_model').optional().isLength({ max: 100 }),
    body('default_voice_id').optional().isLength({ max: 100 }),
    body('timeout_ms').optional().isInt({ min: 1000, max: 300000 }),
    body('max_retries').optional().isInt({ min: 0, max: 10 }),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { id } = req.params;
      const authReq = req as AuthenticatedRequest;
      const tenantId = authReq.tenantId!;
      const userId = authReq.user!.userId;
      const updates = req.body;

      // Verify the configuration exists and belongs to the tenant
      const existing = await getTenantConfigService().findById(id);
      if (!existing || existing.tenant_id !== tenantId) {
        return res.status(404).json({
          success: false,
          error: 'Configuration not found',
        });
      }

      // If changing provider, check for conflicts
      if (updates.provider && updates.provider !== existing.provider) {
        const conflict = await getTenantConfigService().findByTenantAndProvider(
          tenantId,
          updates.provider as ProviderName
        );
        if (conflict) {
          return res.status(409).json({
            success: false,
            error: `Configuration already exists for provider: ${updates.provider}`,
          });
        }
      }

      const config = await getTenantConfigService().update(id, updates, userId);

      // Mask API key in response
      const maskedConfig = {
        ...config,
        api_key_encrypted: '••••••••••••••••',
      };

      res.json({
        success: true,
        data: maskedConfig,
      });
    } catch (error) {
      console.error('Error updating configuration:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update configuration',
      });
    }
  }
);

// Deactivate an AI configuration (soft delete)
router.delete(
  '/config/:id',
  authenticate,
  requireRole('admin', 'owner'),
  param('id').isUUID(),
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { id } = req.params;
      const authReq = req as AuthenticatedRequest;
      const tenantId = authReq.tenantId!;
      const userId = authReq.user!.userId;

      // Verify the configuration exists and belongs to the tenant
      const existing = await getTenantConfigService().findById(id);
      if (!existing || existing.tenant_id !== tenantId) {
        return res.status(404).json({
          success: false,
          error: 'Configuration not found',
        });
      }

      await getTenantConfigService().deactivate(id, userId);

      res.json({
        success: true,
        message: 'Configuration deactivated successfully',
      });
    } catch (error) {
      console.error('Error deactivating configuration:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to deactivate configuration',
      });
    }
  }
);

// Get available providers list
router.get('/providers', async (req: Request, res: Response) => {
  const providers = [
    { name: 'openai', displayName: 'OpenAI', requiresApiKey: true },
    { name: 'anthropic', displayName: 'Anthropic', requiresApiKey: true },
    { name: 'deepgram', displayName: 'Deepgram', requiresApiKey: true },
    { name: 'elevenlabs', displayName: 'ElevenLabs', requiresApiKey: true },
    { name: 'azure-openai', displayName: 'Azure OpenAI', requiresApiKey: true },
    { name: 'google', displayName: 'Google AI', requiresApiKey: true },
    { name: 'mistral', displayName: 'Mistral AI', requiresApiKey: true },
    { name: 'groq', displayName: 'Groq', requiresApiKey: true },
    { name: 'ollama', displayName: 'Ollama', requiresApiKey: false },
    { name: 'custom', displayName: 'Custom Provider', requiresApiKey: true },
  ];

  res.json({
    success: true,
    data: providers,
  });
});

export { router as tenantConfigRoutes };
