import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppErrorBoundary } from '../AppErrorBoundary';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('../../lib/api-client', () => ({
  getLastFailedRequestCorrelationId: vi.fn(() => 'corr-dev-123'),
}));

function ThrowRenderError() {
  throw new Error('Boundary render failure');
}

describe('AppErrorBoundary', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('catches render errors and shows the fallback UI with correlation ID in development', () => {
    render(
      <AppErrorBoundary>
        <ThrowRenderError />
      </AppErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('Boundary render failure')).toBeTruthy();
    expect(screen.getByText('Correlation ID: corr-dev-123')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
