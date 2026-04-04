'use client';

import { useState, useEffect } from 'react';

interface Provider {
  name: string;
  displayName: string;
  requiresApiKey: boolean;
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

export default function SettingsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [configs, setConfigs] = useState<TenantConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingConfig, setEditingConfig] = useState<TenantConfig | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    provider: '',
    api_key: '',
    base_url: '',
    organization: '',
    default_model: '',
    default_voice_id: '',
    timeout_ms: 30000,
    max_retries: 3,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      // Load providers
      const providersRes = await fetch('/api/tenant/providers');
      if (providersRes.ok) {
        const providersData = await providersRes.json();
        setProviders(providersData.data);
      }

      // Load tenant configs
      const configsRes = await fetch('/api/tenant/config');
      if (configsRes.ok) {
        const configsData = await configsRes.json();
        setConfigs(configsData.data);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
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
      default_voice_id: '',
      timeout_ms: 30000,
      max_retries: 3,
    });
    setErrors({});
  };

  const handleAddConfig = () => {
    resetForm();
    setEditingConfig(null);
    setShowAddForm(true);
  };

  const handleEditConfig = (config: TenantConfig) => {
    setFormData({
      provider: config.provider,
      api_key: '', // Don't pre-fill API key for security
      base_url: config.base_url || '',
      organization: config.organization || '',
      default_model: config.default_model || '',
      default_voice_id: config.default_voice_id || '',
      timeout_ms: config.timeout_ms || 30000,
      max_retries: config.max_retries || 3,
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

    if (!formData.api_key && !editingConfig) {
      newErrors.api_key = 'API key is required';
    }

    if (formData.timeout_ms < 1000) {
      newErrors.timeout_ms = 'Timeout must be at least 1000ms';
    }

    if (formData.max_retries < 0) {
      newErrors.max_retries = 'Max retries must be non-negative';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      setSaving(true);

      const submitData = {
        ...formData,
        // Only include API key if it was provided (for updates)
        ...(formData.api_key && { api_key: formData.api_key }),
      };

      let response;
      if (editingConfig) {
        // Update existing config
        response = await fetch(`/api/tenant/config/${editingConfig.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(submitData),
        });
      } else {
        // Create new config
        response = await fetch('/api/tenant/config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(submitData),
        });
      }

      if (response.ok) {
        await loadData(); // Reload configs
        setShowAddForm(false);
        setEditingConfig(null);
        resetForm();
      } else {
        const errorData = await response.json();
        setErrors({ submit: errorData.error || 'Failed to save configuration' });
      }
    } catch (error) {
      console.error('Failed to save config:', error);
      setErrors({ submit: 'Failed to save configuration' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfig = async (configId: string) => {
    if (!confirm('Are you sure you want to deactivate this configuration?')) {
      return;
    }

    try {
      const response = await fetch(`/api/tenant/config/${configId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await loadData(); // Reload configs
      } else {
        alert('Failed to deactivate configuration');
      }
    } catch (error) {
      console.error('Failed to delete config:', error);
      alert('Failed to deactivate configuration');
    }
  };

  const getProviderDisplayName = (providerName: string) => {
    const provider = providers.find((p) => p.name === providerName);
    return provider?.displayName || providerName;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading settings...</p>
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
              Add Configuration
            </button>
          </div>
        </div>

        {/* Configurations List */}
        <div className="mt-8">
          <div className="bg-white shadow overflow-hidden sm:rounded-md">
            <ul role="list" className="divide-y divide-gray-200">
              {configs.length === 0 ? (
                <li className="px-6 py-8 text-center text-gray-500">
                  No AI provider configurations found. Add your first configuration to get started.
                </li>
              ) : (
                configs.map((config) => (
                  <li key={config.id} className="px-6 py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center">
                          <h3 className="text-lg font-medium text-gray-900">
                            {getProviderDisplayName(config.provider)}
                          </h3>
                          <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Active
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-4 text-sm text-gray-500">
                          {config.default_model && <div>Model: {config.default_model}</div>}
                          {config.base_url && <div>Base URL: {config.base_url}</div>}
                          {config.organization && <div>Organization: {config.organization}</div>}
                          <div>Timeout: {config.timeout_ms}ms</div>
                          <div>Max Retries: {config.max_retries}</div>
                        </div>
                      </div>
                      <div className="flex space-x-2">
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
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>

        {/* Add/Edit Form Modal */}
        {showAddForm && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div className="relative top-20 mx-auto p-5 border w-full max-w-2xl shadow-lg rounded-md bg-white">
              <div className="mt-3">
                <h3 className="text-lg font-medium text-gray-900 mb-4">
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
                        <option key={provider.name} value={provider.name}>
                          {provider.displayName}
                        </option>
                      ))}
                    </select>
                    {errors.provider && (
                      <p className="mt-1 text-sm text-red-600">{errors.provider}</p>
                    )}
                  </div>

                  {/* API Key */}
                  <div>
                    <label htmlFor="api_key" className="block text-sm font-medium text-gray-700">
                      API Key * {editingConfig && '(leave blank to keep current)'}
                    </label>
                    <input
                      type="password"
                      id="api_key"
                      value={formData.api_key}
                      onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="sk-..."
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
                      placeholder="https://api.openai.com/v1"
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
                      onChange={(e) => setFormData({ ...formData, default_model: e.target.value })}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="gpt-4, claude-3-sonnet, etc."
                    />
                  </div>

                  {/* Default Voice ID (for ElevenLabs) */}
                  <div>
                    <label
                      htmlFor="default_voice_id"
                      className="block text-sm font-medium text-gray-700"
                    >
                      Default Voice ID (optional, for ElevenLabs)
                    </label>
                    <input
                      type="text"
                      id="default_voice_id"
                      value={formData.default_voice_id}
                      onChange={(e) =>
                        setFormData({ ...formData, default_voice_id: e.target.value })
                      }
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="21m00Tcm4TlvDq8ikWAM"
                    />
                  </div>

                  {/* Timeout */}
                  <div>
                    <label htmlFor="timeout_ms" className="block text-sm font-medium text-gray-700">
                      Timeout (ms)
                    </label>
                    <input
                      type="number"
                      id="timeout_ms"
                      value={formData.timeout_ms}
                      onChange={(e) =>
                        setFormData({ ...formData, timeout_ms: parseInt(e.target.value) })
                      }
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
                      Max Retries
                    </label>
                    <input
                      type="number"
                      id="max_retries"
                      value={formData.max_retries}
                      onChange={(e) =>
                        setFormData({ ...formData, max_retries: parseInt(e.target.value) })
                      }
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
                      {saving ? 'Saving...' : editingConfig ? 'Update' : 'Add Configuration'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
