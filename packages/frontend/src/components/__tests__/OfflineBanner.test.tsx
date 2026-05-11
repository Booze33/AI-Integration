import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { OfflineBanner } from '../OfflineBanner';

describe('OfflineBanner', () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  });

  it('appears when connectivity is lost and disappears when connectivity returns', async () => {
    render(<OfflineBanner />);

    expect(screen.queryByText(/you're offline/i)).toBeNull();

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByText(/you're offline/i)).toBeTruthy();

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });

    expect(screen.queryByText(/you're offline/i)).toBeNull();
  });
});
