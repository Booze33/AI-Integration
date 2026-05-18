import { ProviderCapabilities, ProviderCapability, ProviderName } from './types';

interface ProviderDescriptor {
  name: ProviderName;
  displayName: string;
  requiresApiKey: boolean;
  capabilities: ProviderCapabilities;
}

const NO_CAPABILITIES: ProviderCapabilities = {
  chat: false,
  chatStream: false,
  transcribe: false,
  realtimeTranscribe: false,
  speak: false,
  embed: false,
  embedBatch: false,
};

export const PROVIDER_CATALOG: Record<ProviderName, ProviderDescriptor> = {
  openai: {
    name: 'openai',
    displayName: 'OpenAI',
    requiresApiKey: true,
    capabilities: {
      chat: true,
      chatStream: true,
      transcribe: true,
      realtimeTranscribe: false,
      speak: true,
      embed: true,
      embedBatch: true,
    },
  },
  anthropic: {
    name: 'anthropic',
    displayName: 'Anthropic',
    requiresApiKey: true,
    capabilities: {
      chat: true,
      chatStream: true,
      transcribe: false,
      realtimeTranscribe: false,
      speak: false,
      embed: false,
      embedBatch: false,
    },
  },
  deepgram: {
    name: 'deepgram',
    displayName: 'Deepgram',
    requiresApiKey: true,
    capabilities: {
      chat: false,
      chatStream: false,
      transcribe: true,
      realtimeTranscribe: true,
      speak: false,
      embed: false,
      embedBatch: false,
    },
  },
  elevenlabs: {
    name: 'elevenlabs',
    displayName: 'ElevenLabs',
    requiresApiKey: true,
    capabilities: {
      chat: false,
      chatStream: false,
      transcribe: false,
      realtimeTranscribe: false,
      speak: true,
      embed: false,
      embedBatch: false,
    },
  },
  'azure-openai': {
    name: 'azure-openai',
    displayName: 'Azure OpenAI',
    requiresApiKey: true,
    capabilities: NO_CAPABILITIES,
  },
  google: {
    name: 'google',
    displayName: 'Google AI',
    requiresApiKey: true,
    capabilities: NO_CAPABILITIES,
  },
  mistral: {
    name: 'mistral',
    displayName: 'Mistral AI',
    requiresApiKey: true,
    capabilities: NO_CAPABILITIES,
  },
  groq: {
    name: 'groq',
    displayName: 'Groq',
    requiresApiKey: true,
    capabilities: NO_CAPABILITIES,
  },
  ollama: {
    name: 'ollama',
    displayName: 'Ollama',
    requiresApiKey: false,
    capabilities: NO_CAPABILITIES,
  },
  custom: {
    name: 'custom',
    displayName: 'Custom Provider',
    requiresApiKey: true,
    capabilities: NO_CAPABILITIES,
  },
};

export function getProviderCapabilities(name: ProviderName): ProviderCapabilities {
  return PROVIDER_CATALOG[name]?.capabilities || NO_CAPABILITIES;
}

export function supportsCapability(name: ProviderName, capability: ProviderCapability): boolean {
  return Boolean(getProviderCapabilities(name)[capability]);
}

export function listProviderDescriptors(): ProviderDescriptor[] {
  return Object.values(PROVIDER_CATALOG);
}
