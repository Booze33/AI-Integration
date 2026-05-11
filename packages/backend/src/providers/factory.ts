/**
 * AI Provider Factory
 *
 * Creates and manages AI provider instances based on configuration.
 * Switching providers is as simple as changing the ACTIVE_AI_PROVIDER environment variable.
 * Supports per-tenant provider configurations with encrypted API keys.
 */

import { AIProvider, ProviderConfig, ProviderName } from './types';
import { TenantAIConfig, TenantAIConfigService } from './tenant-config';

// Provider implementations will be imported here
// import { OpenAIProvider } from './implementations/openai';
// import { AnthropicProvider } from './implementations/anthropic';
// import { AzureOpenAIProvider } from './implementations/azure-openai';
// import { GoogleProvider } from './implementations/google';
// import { MistralProvider } from './implementations/mistral';
// import { GroqProvider } from './implementations/groq';
// import { OllamaProvider } from './implementations/ollama';
// import { CustomProvider } from './implementations/custom';

/**
 * Environment configuration for AI providers
 */
interface ProviderEnvConfig {
  ACTIVE_AI_PROVIDER: ProviderName;
  AI_API_KEY: string;
  AI_BASE_URL?: string;
  AI_ORGANIZATION?: string;
  AI_DEFAULT_MODEL?: string;
  AI_TIMEOUT?: string;
  AI_MAX_RETRIES?: string;
}

/**
 * Get provider configuration from environment variables
 */
function getProviderConfigFromEnv(): { provider: ProviderName; config: ProviderConfig } {
  const env = process.env as unknown as ProviderEnvConfig;

  const provider = env.ACTIVE_AI_PROVIDER || 'openai';

  if (!env.AI_API_KEY && provider !== 'ollama' && provider !== 'custom') {
    throw new Error(`AI_API_KEY environment variable is required for provider: ${provider}`);
  }

  const config: ProviderConfig = {
    apiKey: env.AI_API_KEY || '',
    baseUrl: env.AI_BASE_URL,
    organization: env.AI_ORGANIZATION,
    defaultModel: env.AI_DEFAULT_MODEL,
    timeout: env.AI_TIMEOUT ? parseInt(env.AI_TIMEOUT, 10) : undefined,
    maxRetries: env.AI_MAX_RETRIES ? parseInt(env.AI_MAX_RETRIES, 10) : undefined,
  };

  return { provider, config };
}

/**
 * Provider constructor type
 */
type ProviderConstructor = new (config: ProviderConfig) => AIProvider;

/**
 * Registry of available providers
 */
const providerRegistry: Map<ProviderName, ProviderConstructor> = new Map();

/**
 * Register a provider implementation
 */
export function registerProvider(name: ProviderName, constructor: ProviderConstructor): void {
  providerRegistry.set(name, constructor);
}

/**
 * Create a provider instance by name
 */
export function createProvider(name: ProviderName, config: ProviderConfig): AIProvider {
  const ProviderClass = providerRegistry.get(name);

  if (!ProviderClass) {
    const available = Array.from(providerRegistry.keys()).join(', ');
    throw new Error(
      `Unknown provider: ${name}. Available providers: ${available || 'none registered'}`
    );
  }

  return new ProviderClass(config);
}

/**
 * Create a provider from environment variables
 * This is the main entry point for provider switching
 */
export function createProviderFromEnv(): AIProvider {
  const { provider, config } = getProviderConfigFromEnv();
  return createProvider(provider, config);
}

/**
 * Singleton provider instance (for global/default provider)
 */
let providerInstance: AIProvider | null = null;

/**
 * Map of tenant-specific provider instances
 */
const tenantProviders: Map<string, Map<ProviderName, AIProvider>> = new Map();

/**
 * Get the singleton provider instance (global/default)
 * Creates the instance on first call using environment configuration
 */
export function getProvider(): AIProvider {
  if (!providerInstance) {
    providerInstance = createProviderFromEnv();
  }
  return providerInstance;
}

/**
 * Get a provider for a specific tenant
 * Uses tenant-specific configuration if available, otherwise falls back to global
 *
 * @param tenantId - The tenant ID
 * @param providerName - Optional specific provider name, defaults to tenant's active provider
 * @param configService - Optional tenant config service for decryption
 * @returns The provider instance for the tenant
 */
export async function getProviderForTenant(
  tenantId: string,
  providerName?: ProviderName,
  configService?: TenantAIConfigService,
  tenantConfig?: TenantAIConfig
): Promise<AIProvider> {
  // If tenant config is provided, use it
  if (tenantConfig && configService) {
    // Check if we already have a provider instance for this tenant+provider
    const tenantProviderMap = tenantProviders.get(tenantId);
    if (tenantProviderMap?.has(tenantConfig.provider)) {
      return tenantProviderMap.get(tenantConfig.provider)!;
    }

    // Create new provider instance with tenant config
    const providerConfig = configService.toProviderConfig(tenantConfig);
    const provider = createProvider(tenantConfig.provider, providerConfig);

    // Cache the provider instance
    if (!tenantProviders.has(tenantId)) {
      tenantProviders.set(tenantId, new Map());
    }
    tenantProviders.get(tenantId)!.set(tenantConfig.provider, provider);

    return provider;
  }

  // Fall back to global provider
  return getProvider();
}

/**
 * Create a provider for a tenant using their configuration
 */
export function createProviderForTenant(
  tenantId: string,
  config: TenantAIConfig,
  configService: TenantAIConfigService
): AIProvider {
  const providerConfig = configService.toProviderConfig(config);
  const provider = createProvider(config.provider, providerConfig);

  // Cache the provider instance
  if (!tenantProviders.has(tenantId)) {
    tenantProviders.set(tenantId, new Map());
  }
  tenantProviders.get(tenantId)!.set(config.provider, provider);

  return provider;
}

/**
 * Reset the singleton instance
 * Useful for testing or when configuration changes
 */
export function resetProvider(): void {
  providerInstance = null;
}

/**
 * Reset tenant provider instances
 * Useful when tenant configuration changes
 */
export function resetTenantProviders(tenantId?: string): void {
  if (tenantId) {
    tenantProviders.delete(tenantId);
  } else {
    tenantProviders.clear();
  }
}

/**
 * Get cached provider for a tenant (if exists)
 */
export function getCachedProviderForTenant(
  tenantId: string,
  providerName: ProviderName
): AIProvider | undefined {
  return tenantProviders.get(tenantId)?.get(providerName);
}

/**
 * Get available registered providers
 */
export function getAvailableProviders(): ProviderName[] {
  return Array.from(providerRegistry.keys());
}

/**
 * Validate provider configuration
 */
export function validateProviderConfig(config: Partial<ProviderConfig>): string[] {
  const errors: string[] = [];

  if (!config.apiKey) {
    errors.push('API key is required');
  }

  if (config.timeout !== undefined && config.timeout < 0) {
    errors.push('Timeout must be a positive number');
  }

  if (config.maxRetries !== undefined && config.maxRetries < 0) {
    errors.push('Max retries must be a positive number');
  }

  return errors;
}

// Re-export types for convenience
export type { AIProvider, ProviderConfig, ProviderName } from './types';
