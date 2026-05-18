'use client';

import { useState, useEffect, useRef } from 'react';
import { ApiError, apiClient, User } from '../../../lib/api-client';
import { OPENAI_API_V1_BASE_URL } from '../../../lib/constants';
import { useToast } from '../../../components/toast/ToastProvider';
import { useFocusTrap } from '../../../lib/useFocusTrap';
import { usePageTitle } from '../../../lib/usePageTitle';

interface Provider {
  name: string;
  displayName: string;
  requiresApiKey: boolean;
  capabilities?: {
    chat: boolean;
    chatStream: boolean;
    transcribe: boolean;
    realtimeTranscribe: boolean;
    speak: boolean;
    embed: boolean;
    embedBatch: boolean;
  };
}

interface TenantConfig {
  id: string;
  tenant_id: string;
  provider: string;
  api_key_encrypted: string;
  base_url?: string;
  organization?: string;
  default_model?: string;
  default_voice_id?: string;
  timeout_ms?: number;
  max_retries?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface TenantUsageCaps {
  tenantId: string;
  dailyCapTokens: number | null;
  monthlyCapTokens: number | null;
  hardCapEnabled: boolean;
}

interface TenantUsageSnapshot {
  tenantId: string;
  dailyUsedTokens: number;
  monthlyUsedTokens: number;
  usageDateUtc: string;
  usageMonthUtc: string;
}

export default function SettingsPage() {
  usePageTitle('Settings - AI Providers | AI Integration Platform');
  const { showToast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [configs, setConfigs] = useState<TenantConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingConfig, setEditingConfig] = useState<TenantConfig | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ configId: string; message: string } | null>(
    null
  );
  const [usageCaps, setUsageCaps] = useState<TenantUsageCaps | null>(null);
  const [usageSnapshot, setUsageSnapshot] = useState<TenantUsageSnapshot | null>(null);
  const [capsSaving, setCapsSaving] = useState(false);
  const [capsError, setCapsError] = useState<string | null>(null);
  const [capsFormData, setCapsFormData] = useState({
    dailyCapTokens: '',
    monthlyCapTokens: '',
    hardCapEnabled: true,
  });

  // Form state
  const [formData, setFormData] = useState({
    provider: '',
    api_key: '',
    base_url: '',
    organization: '',
    default_model: '',
    timeout_ms: '',
    max_retries: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const modalRef = useRef<HTMLDivElement | null>(null);
  const canManageProviders = user ? ['admin', 'owner'].includes(user.role) : false;
  const selectedProvider = providers.find((provider) => provider.name === formData.provider);
  //  const selectedProviderCapabilities = selectedProvider?.capabilities;
  const selectedProviderRequiresApiKey = selectedProvider?.requiresApiKey ?? true;
  useFocusTrap(showAddForm, modalRef, () => setShowAddForm(false));

  const capabilityLabels: Record<string, string> = {
    chat: 'Chat',
    chatStream: 'Streaming Chat',
    transcribe: 'Transcription',
    realtimeTranscribe: 'Realtime Transcription',
    speak: 'Speech Synthesis',
    embed: 'Embeddings',
    embedBatch: 'Batch Embeddings',
  };

  const getCapabilityEntries = (provider?: Provider) =>
    Object.entries(provider?.capabilities || {}).filter((entry): entry is [string, boolean] => {
      const [enabled] = entry;
      return typeof enabled === 'boolean';
    });

  const getEnabledCapabilities = (provider?: Provider) =>
    getCapabilityEntries(provider)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setShowAddForm(false);
      setEditingConfig(null);
      setPageError(null);
      setDeleteError(null);

      const currentUserResponse = await apiClient.getCurrentUser();
      setUser(currentUserResponse.user);

      if (!['admin', 'owner'].includes(currentUserResponse.user.role)) {
        setProviders([]);
        setConfigs([]);
        setUsageCaps(null);
        setUsageSnapshot(null);
        return;
      }

      const [providersResponse, configsResponse, usageCapsResponse] = await Promise.all([
        apiClient.getProviders(),
        apiClient.getTenantConfigs(),
        apiClient.getTenantUsageCaps(),
      ]);
      setProviders(providersResponse.data);
      setConfigs(configsResponse.data);
      setUsageCaps(usageCapsResponse.data.caps);
      setUsageSnapshot(usageCapsResponse.data.usage);
      setCapsFormData({
        dailyCapTokens:
          usageCapsResponse.data.caps.dailyCapTokens === null
            ? ''
            : String(usageCapsResponse.data.caps.dailyCapTokens),
        monthlyCapTokens:
          usageCapsResponse.data.caps.monthlyCapTokens === null
            ? ''
            : String(usageCapsResponse.data.caps.monthlyCapTokens),
        hardCapEnabled: usageCapsResponse.data.caps.hardCapEnabled,
      });
    } catch (error) {
      console.error('Failed to load data:', error);
      if (!(error instanceof ApiError && (error.statusCode === 401 || error.statusCode === 403))) {
        setPageError(
          error instanceof Error ? error.message : 'Failed to load AI provider settings.'
        );
        showToast('Network error while loading AI providers.', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      provider: '',
      api_key: '',
      base_url: '',
      organization: '',
      default_model: '',
      timeout_ms: '',
      max_retries: '',
    });
    setErrors({});
  };

  const handleAddConfig = () => {
    if (!canManageProviders) {
      return;
    }

    setPageError(null);
    resetForm();
    setEditingConfig(null);
    setShowAddForm(true);
  };

  const handleEditConfig = (config: TenantConfig) => {
    if (!canManageProviders) {
      return;
    }

    setDeleteError(null);
    setFormData({
      provider: config.provider,
      api_key: '', // Don't pre-fill API key for security
      base_url: config.base_url || '',
      organization: config.organization || '',
      default_model: config.default_model || '',
      timeout_ms: config.timeout_ms?.toString() || '',
      max_retries: config.max_retries?.toString() || '',
    });
    setEditingConfig(config);
    setShowAddForm(true);
  };

  const handleCancel = () => {
    setShowAddForm(false);
    setEditingConfig(null);
    resetForm();
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.provider) {
      newErrors.provider = 'Provider is required';
    }

    if (selectedProviderRequiresApiKey && !formData.api_key) {
      newErrors.api_key = 'API key is required';
    }

    if (selectedProvider && getEnabledCapabilities(selectedProvider).length === 0) {
      newErrors.provider = 'Selected provider is not yet available for app actions';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canManageProviders) {
      setErrors({ submit: 'Only admin or owner accounts can manage provider settings.' });
      return;
    }

    if (!validateForm()) {
      return;
    }

    try {
      setSaving(true);
      setPageError(null);
      setErrors({});

      const parsedTimeout = formData.timeout_ms ? Number(formData.timeout_ms) : undefined;
      const parsedMaxRetries = formData.max_retries ? Number(formData.max_retries) : undefined;

      if (parsedTimeout !== undefined && parsedTimeout < 1000) {
        setErrors({ timeout_ms: 'Timeout must be at least 1000ms' });
        return;
      }

      if (parsedMaxRetries !== undefined && (parsedMaxRetries < 0 || parsedMaxRetries > 10)) {
        setErrors({ max_retries: 'Max retries must be between 0 and 10' });
        return;
      }

      const submitData = {
        provider: formData.provider,
        api_key: formData.api_key,
        ...(formData.base_url ? { base_url: formData.base_url } : {}),
        ...(formData.organization ? { organization: formData.organization } : {}),
        ...(formData.default_model ? { default_model: formData.default_model } : {}),
        ...(parsedTimeout !== undefined ? { timeout_ms: parsedTimeout } : {}),
        ...(parsedMaxRetries !== undefined ? { max_retries: parsedMaxRetries } : {}),
      };

      let response;
      if (editingConfig) {
        // Update existing config
        response = await apiClient.updateTenantConfig(editingConfig.id, submitData);
      } else {
        // Create new config
        response = await apiClient.createTenantConfig(submitData);
      }

      if (response.success) {
        await loadData(); // Reload configs
        setShowAddForm(false);
        setEditingConfig(null);
        resetForm();
        if (!editingConfig) {
          showToast('Provider configuration created successfully.', 'success');
        }
      } else {
        setErrors({ submit: 'Failed to save configuration' });
      }
    } catch (error) {
      console.error('Failed to save config:', error);
      if (error instanceof ApiError && error.statusCode === 409) {
        setErrors({ submit: 'A configuration for this provider already exists.' });
        return;
      }

      setErrors({
        submit: error instanceof Error ? error.message : 'Failed to save configuration',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfig = async (configId: string) => {
    if (!canManageProviders) {
      return;
    }

    if (!confirm('Are you sure you want to deactivate this configuration?')) {
      return;
    }

    try {
      setDeleteError(null);
      const response = await apiClient.deleteTenantConfig(configId);

      if (response.success) {
        await loadData(); // Reload configs
        showToast('Provider configuration deactivated successfully.', 'success');
      } else {
        setDeleteError({
          configId,
          message: 'Failed to deactivate this provider configuration. Please try again.',
        });
        showToast('Network error while deactivating provider.', 'error');
      }
    } catch (error) {
      console.error('Failed to delete config:', error);
      if (!(error instanceof ApiError && error.statusCode === 401)) {
        setDeleteError({
          configId,
          message:
            error instanceof Error
              ? error.message
              : 'Failed to deactivate this provider configuration.',
        });
        showToast('Network error while deactivating provider.', 'error');
      }
    }
  };

  const handleSaveTokenCaps = async () => {
    if (!canManageProviders) {
      return;
    }

    try {
      setCapsSaving(true);
      setCapsError(null);

      const parsedDaily = capsFormData.dailyCapTokens ? Number(capsFormData.dailyCapTokens) : null;
      const parsedMonthly = capsFormData.monthlyCapTokens
        ? Number(capsFormData.monthlyCapTokens)
        : null;

      if (parsedDaily !== null && (!Number.isInteger(parsedDaily) || parsedDaily <= 0)) {
        setCapsError('Daily cap must be a positive integer.');
        return;
      }

      if (parsedMonthly !== null && (!Number.isInteger(parsedMonthly) || parsedMonthly <= 0)) {
        setCapsError('Monthly cap must be a positive integer.');
        return;
      }

      const response = await apiClient.updateTenantUsageCaps({
        dailyCapTokens: parsedDaily,
        monthlyCapTokens: parsedMonthly,
        hardCapEnabled: capsFormData.hardCapEnabled,
      });

      setUsageCaps(response.data.caps);
      setUsageSnapshot(response.data.usage);
      showToast('Token usage caps updated.', 'success');
    } catch (error) {
      console.error('Failed to update token caps:', error);
      setCapsError(error instanceof Error ? error.message : 'Failed to update token usage caps.');
      showToast('Failed to update token usage caps.', 'error');
    } finally {
      setCapsSaving(false);
    }
  };

  const getProviderDisplayName = (providerName: string) => {
    const provider = providers.find((p) => p.name === providerName);
    return provider?.displayName || providerName;
  };

  const getProviderIcon = (providerName: string) => {
    const normalized = providerName.toLowerCase();

    if (normalized.includes('openai')) return 'OAI';
    if (normalized.includes('anthropic')) return 'ANT';
    if (normalized.includes('azure')) return 'AZ';
    if (normalized.includes('elevenlabs')) return '11';
    if (normalized.includes('google') || normalized.includes('gemini')) return 'G';

    return 'AI';
  };

  const getMaskedApiKey = () => '••••••••••••••••';

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          <div className="space-y-4 mt-8">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <div className="h-11 w-11 rounded-lg skeleton-shimmer"></div>
                    <div className="min-w-0 flex-1">
                      <div className="h-5 w-40 rounded skeleton-shimmer"></div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <div className="h-4 w-full rounded skeleton-shimmer"></div>
                        <div className="h-4 w-full rounded skeleton-shimmer"></div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-14 rounded-md skeleton-shimmer"></div>
                    <div className="h-8 w-20 rounded-md skeleton-shimmer"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (user && !canManageProviders) {
    return (
      <div className="min-h-screen flex items-center justify-center p-10 bg-gray-50">
        <div className="rounded-lg border border-orange-300 bg-orange-50 p-6 text-center shadow-sm">
          <h2 className="text-xl font-semibold text-orange-700">Access denied</h2>
          <p className="mt-2 text-sm text-orange-600">
            Your role ({user.role}) does not have permission to manage AI provider settings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <div className="md:flex md:items-center md:justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight">
              AI Provider Settings
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Configure your AI provider integrations and API keys
            </p>
          </div>
          <div className="mt-4 flex md:mt-0 md:ml-4">
            <button
              onClick={handleAddConfig}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Add Provider
            </button>
          </div>
        </div>

        {pageError ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {pageError}
          </div>
        ) : null}

        <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Tenant Token Usage Caps</h3>
              <p className="mt-1 text-sm text-gray-600">
                Configure hard daily/monthly limits to prevent accidental AI overspend.
              </p>
            </div>
            <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
              Daily used: {usageSnapshot?.dailyUsedTokens ?? 0} | Monthly used:{' '}
              {usageSnapshot?.monthlyUsedTokens ?? 0}
            </span>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div>
              <label htmlFor="daily-cap" className="block text-sm font-medium text-gray-700">
                Daily Cap (tokens)
              </label>
              <input
                id="daily-cap"
                type="number"
                min="1"
                value={capsFormData.dailyCapTokens}
                onChange={(e) =>
                  setCapsFormData((prev) => ({ ...prev, dailyCapTokens: e.target.value }))
                }
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                placeholder="Leave blank for unlimited"
              />
            </div>
            <div>
              <label htmlFor="monthly-cap" className="block text-sm font-medium text-gray-700">
                Monthly Cap (tokens)
              </label>
              <input
                id="monthly-cap"
                type="number"
                min="1"
                value={capsFormData.monthlyCapTokens}
                onChange={(e) =>
                  setCapsFormData((prev) => ({ ...prev, monthlyCapTokens: e.target.value }))
                }
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                placeholder="Leave blank for unlimited"
              />
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={capsFormData.hardCapEnabled}
                  onChange={(e) =>
                    setCapsFormData((prev) => ({ ...prev, hardCapEnabled: e.target.checked }))
                  }
                />
                Enforce hard cap (429 on exceed)
              </label>
            </div>
          </div>

          {capsError ? (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {capsError}
            </div>
          ) : null}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={handleSaveTokenCaps}
              disabled={capsSaving}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {capsSaving ? 'Saving caps...' : 'Save Token Caps'}
            </button>
          </div>

          <div className="mt-3 text-xs text-gray-500">
            Current caps: Daily {usageCaps?.dailyCapTokens ?? 'Unlimited'} | Monthly{' '}
            {usageCaps?.monthlyCapTokens ?? 'Unlimited'}
          </div>
        </section>

        {/* Configurations List */}
        <div className="mt-8">
          <div className="space-y-4">
            <ul role="list" className="space-y-4">
              {configs.length === 0 ? (
                <li className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
                  <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                    🤖
                  </div>
                  <p className="text-base font-semibold text-gray-900">
                    No AI providers configured.
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    Add one to configure your model integrations.
                  </p>
                  <button
                    type="button"
                    onClick={handleAddConfig}
                    className="mt-4 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    Add Provider
                  </button>
                </li>
              ) : (
                configs.map((config) => (
                  <li
                    key={config.id}
                    className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex min-w-0 flex-1 gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-sm font-bold text-blue-700 ring-1 ring-blue-200">
                          {getProviderIcon(config.provider)}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-medium text-gray-900">
                              {getProviderDisplayName(config.provider)}
                            </h3>
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                config.is_active
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-gray-200 text-gray-700'
                              }`}
                            >
                              {config.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </div>

                          <div className="mt-3 grid gap-2 text-sm text-gray-600 sm:grid-cols-2">
                            <p>
                              <span className="font-medium text-gray-700">Default model:</span>{' '}
                              {config.default_model || 'Not set'}
                            </p>
                            <p>
                              <span className="font-medium text-gray-700">API key:</span>{' '}
                              {getMaskedApiKey()}
                            </p>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">
                            {getCapabilityEntries(
                              providers.find((provider) => provider.name === config.provider)
                            ).map(([name, enabled]) => (
                              <span
                                key={`${config.id}-${name}`}
                                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                  enabled
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-gray-100 text-gray-500'
                                }`}
                              >
                                {capabilityLabels[name] || name}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleEditConfig(config)}
                          className="inline-flex items-center px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteConfig(config.id)}
                          className="inline-flex items-center px-3 py-1 border border-red-300 rounded-md text-sm font-medium text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                        >
                          Deactivate
                        </button>
                      </div>
                    </div>
                    {deleteError?.configId === config.id ? (
                      <p className="mt-3 text-sm text-red-600">{deleteError.message}</p>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>

        {/* Add/Edit Form Modal */}
        {showAddForm && (
          <div className="fixed inset-0 z-50 bg-gray-600/50">
            <div className="flex min-h-full items-end md:block md:overflow-y-auto md:py-16">
              <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="provider-modal-title"
                tabIndex={-1}
                className="relative w-full rounded-t-2xl border bg-white p-5 shadow-lg md:mx-auto md:w-full md:max-w-2xl md:rounded-md"
              >
                <div className="mt-3">
                  <h3 id="provider-modal-title" className="text-lg font-medium text-gray-900 mb-4">
                    {editingConfig ? 'Edit Configuration' : 'Add AI Provider Configuration'}
                  </h3>

                  <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Provider Selection */}
                    <div>
                      <label htmlFor="provider" className="block text-sm font-medium text-gray-700">
                        Provider *
                      </label>
                      <select
                        id="provider"
                        value={formData.provider}
                        onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
                        disabled={!!editingConfig} // Can't change provider when editing
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                      >
                        <option value="">Select a provider</option>
                        {providers.map((provider) => (
                          <option
                            key={provider.name}
                            value={provider.name}
                            disabled={getEnabledCapabilities(provider).length === 0}
                          >
                            {provider.displayName}
                            {getEnabledCapabilities(provider).length === 0 ? ' (Unavailable)' : ''}
                          </option>
                        ))}
                      </select>
                      {errors.provider && (
                        <p className="mt-1 text-sm text-red-600">{errors.provider}</p>
                      )}
                    </div>

                    {selectedProvider ? (
                      <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                        <p className="text-sm font-medium text-gray-700">Action availability</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {getCapabilityEntries(selectedProvider).map(([name, enabled]) => (
                            <span
                              key={`selected-provider-${name}`}
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                enabled
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-gray-100 text-gray-500'
                              }`}
                            >
                              {capabilityLabels[name] || name}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {/* API Key */}
                    <div>
                      <label htmlFor="api_key" className="block text-sm font-medium text-gray-700">
                        API Key {selectedProviderRequiresApiKey ? '*' : '(optional)'}
                      </label>
                      <input
                        type="password"
                        id="api_key"
                        value={formData.api_key}
                        onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        placeholder={
                          selectedProviderRequiresApiKey ? 'sk-...' : 'Optional for this provider'
                        }
                      />
                      {errors.api_key && (
                        <p className="mt-1 text-sm text-red-600">{errors.api_key}</p>
                      )}
                    </div>

                    {/* Base URL */}
                    <div>
                      <label htmlFor="base_url" className="block text-sm font-medium text-gray-700">
                        Base URL (optional)
                      </label>
                      <input
                        type="url"
                        id="base_url"
                        value={formData.base_url}
                        onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        placeholder={OPENAI_API_V1_BASE_URL}
                      />
                    </div>

                    {/* Organization */}
                    <div>
                      <label
                        htmlFor="organization"
                        className="block text-sm font-medium text-gray-700"
                      >
                        Organization ID (optional)
                      </label>
                      <input
                        type="text"
                        id="organization"
                        value={formData.organization}
                        onChange={(e) => setFormData({ ...formData, organization: e.target.value })}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        placeholder="org-..."
                      />
                    </div>

                    {/* Default Model */}
                    <div>
                      <label
                        htmlFor="default_model"
                        className="block text-sm font-medium text-gray-700"
                      >
                        Default Model (optional)
                      </label>
                      <input
                        type="text"
                        id="default_model"
                        value={formData.default_model}
                        onChange={(e) =>
                          setFormData({ ...formData, default_model: e.target.value })
                        }
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        placeholder="gpt-4, claude-3-sonnet, etc."
                      />
                    </div>

                    {/* Default Voice ID (for ElevenLabs) */}
                    {/* Timeout */}
                    <div>
                      <label
                        htmlFor="timeout_ms"
                        className="block text-sm font-medium text-gray-700"
                      >
                        Timeout (ms) (optional)
                      </label>
                      <input
                        type="number"
                        id="timeout_ms"
                        value={formData.timeout_ms}
                        onChange={(e) => setFormData({ ...formData, timeout_ms: e.target.value })}
                        min="1000"
                        max="300000"
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      />
                      {errors.timeout_ms && (
                        <p className="mt-1 text-sm text-red-600">{errors.timeout_ms}</p>
                      )}
                    </div>

                    {/* Max Retries */}
                    <div>
                      <label
                        htmlFor="max_retries"
                        className="block text-sm font-medium text-gray-700"
                      >
                        Max Retries (optional)
                      </label>
                      <input
                        type="number"
                        id="max_retries"
                        value={formData.max_retries}
                        onChange={(e) => setFormData({ ...formData, max_retries: e.target.value })}
                        min="0"
                        max="10"
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      />
                      {errors.max_retries && (
                        <p className="mt-1 text-sm text-red-600">{errors.max_retries}</p>
                      )}
                    </div>

                    {/* Submit Error */}
                    {errors.submit && (
                      <div className="rounded-md bg-red-50 p-4">
                        <p className="text-sm text-red-800">{errors.submit}</p>
                      </div>
                    )}

                    {/* Form Actions */}
                    <div className="flex justify-end space-x-3 pt-4">
                      <button
                        type="button"
                        onClick={handleCancel}
                        className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={saving}
                        className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                      >
                        {saving ? 'Saving...' : editingConfig ? 'Update' : 'Add Provider'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
