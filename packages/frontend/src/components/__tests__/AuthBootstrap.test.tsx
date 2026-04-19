import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthBootstrap } from '../AuthBootstrap';

const apiFetchMock = vi.hoisted(() => vi.fn());
const clearAuthStateMock = vi.hoisted(() => vi.fn());
const setAuthUserMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/api/client', () => ({
  apiFetch: apiFetchMock,
}));

vi.mock('../../lib/auth-store', () => ({
  clearAuthState: clearAuthStateMock,
  setAuthUser: setAuthUserMock,
}));

describe('AuthBootstrap', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    clearAuthStateMock.mockReset();
    setAuthUserMock.mockReset();
  });

  it('shows a network fallback instead of a blank screen when the auth check fails', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('fetch failed'));

    render(
      <AuthBootstrap>
        <div>ready content</div>
      </AuthBootstrap>
    );

    await waitFor(() => {
      expect(screen.getByText('Unable to connect to server')).toBeTruthy();
    });

    expect(screen.getByText(/we couldn't complete the initial auth check/i)).toBeTruthy();
    expect(screen.queryByText('ready content')).toBeNull();
  });
});
