import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SettingsPage from './page';

const showToastMock = vi.hoisted(() => vi.fn());
const apiClientMock = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getProviders: vi.fn(),
  getTenantConfigs: vi.fn(),
  getTenantUsageCaps: vi.fn(),
  deleteTenantConfig: vi.fn(),
}));

vi.mock('../../../components/toast/ToastProvider', () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

vi.mock('../../../lib/api-client', () => ({
  ApiError: class ApiError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 500) {
      super(message);
      this.statusCode = statusCode;
    }
  },
  apiClient: apiClientMock,
}));

describe('AI Provider Settings error states', () => {
  beforeEach(() => {
    showToastMock.mockReset();
    apiClientMock.getCurrentUser.mockReset();
    apiClientMock.getProviders.mockReset();
    apiClientMock.getTenantConfigs.mockReset();
    apiClientMock.getTenantUsageCaps.mockReset();
    apiClientMock.deleteTenantConfig.mockReset();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    );
  });

  it('renders an inline page error when the initial load fails', async () => {
    apiClientMock.getCurrentUser.mockRejectedValueOnce(new Error('Network down'));

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Network down')).toBeTruthy();
    });
  });

  it('renders an inline row error when deactivation fails', async () => {
    apiClientMock.getCurrentUser.mockResolvedValueOnce({
      user: { id: 'u1', email: 'admin@example.com', role: 'admin' },
    });
    apiClientMock.getProviders.mockResolvedValueOnce({
      data: [
        {
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
      ],
    });
    apiClientMock.getTenantConfigs.mockResolvedValueOnce({
      data: [
        {
          id: 'cfg-1',
          tenant_id: 'tenant-1',
          provider: 'openai',
          api_key_encrypted: '••••••••••••••••',
          is_active: true,
          created_at: '2026-04-19T00:00:00.000Z',
          updated_at: '2026-04-19T00:00:00.000Z',
        },
      ],
    });
    apiClientMock.getTenantUsageCaps.mockResolvedValueOnce({
      data: {
        caps: {
          tenantId: 'tenant-1',
          dailyCapTokens: null,
          monthlyCapTokens: null,
          hardCapEnabled: true,
        },
        usage: {
          tenantId: 'tenant-1',
          dailyUsedTokens: 0,
          monthlyUsedTokens: 0,
          usageDateUtc: '2026-05-15',
          usageMonthUtc: '2026-05-01',
        },
      },
    });
    apiClientMock.deleteTenantConfig.mockRejectedValueOnce(new Error('Delete failed'));

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('AI Provider Settings')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeTruthy();
    });
  });

  it('surfaces provider capability action availability and disables unavailable providers', async () => {
    apiClientMock.getCurrentUser.mockResolvedValueOnce({
      user: { id: 'u1', email: 'admin@example.com', role: 'admin' },
    });
    apiClientMock.getProviders.mockResolvedValueOnce({
      data: [
        {
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
        {
          name: 'azure-openai',
          displayName: 'Azure OpenAI',
          requiresApiKey: true,
          capabilities: {
            chat: false,
            chatStream: false,
            transcribe: false,
            realtimeTranscribe: false,
            speak: false,
            embed: false,
            embedBatch: false,
          },
        },
      ],
    });
    apiClientMock.getTenantConfigs.mockResolvedValueOnce({ data: [] });
    apiClientMock.getTenantUsageCaps.mockResolvedValueOnce({
      data: {
        caps: {
          tenantId: 'tenant-1',
          dailyCapTokens: null,
          monthlyCapTokens: null,
          hardCapEnabled: true,
        },
        usage: {
          tenantId: 'tenant-1',
          dailyUsedTokens: 0,
          monthlyUsedTokens: 0,
          usageDateUtc: '2026-05-15',
          usageMonthUtc: '2026-05-01',
        },
      },
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Add Provider' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Add Provider' })[0]);

    const providerSelect = screen.getByLabelText('Provider *') as HTMLSelectElement;
    const unavailableProviderOption = Array.from(providerSelect.options).find(
      (option) => option.value === 'azure-openai'
    );

    expect(unavailableProviderOption?.disabled).toBe(true);

    fireEvent.change(providerSelect, { target: { value: 'openai' } });

    await waitFor(() => {
      expect(screen.getByText('Action availability')).toBeTruthy();
      expect(screen.getByText('Streaming Chat')).toBeTruthy();
      expect(screen.getByText('Realtime Transcription')).toBeTruthy();
    });
  });
});
