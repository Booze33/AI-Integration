const DEFAULT_POST_LOGIN_PATH = '/dashboard';

function isSafeInternalRedirect(target: string): boolean {
  return target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/login');
}

export function resolvePostLoginRedirect(
  redirectTarget: string | null | undefined,
  fallback = DEFAULT_POST_LOGIN_PATH
): string {
  if (!redirectTarget) {
    return fallback;
  }

  return isSafeInternalRedirect(redirectTarget) ? redirectTarget : fallback;
}

export function getCurrentRelativeUrl(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_POST_LOGIN_PATH;
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function getLoginRedirectPath(redirectTarget: string): string {
  const safeTarget = resolvePostLoginRedirect(redirectTarget);
  return `/login?redirect=${encodeURIComponent(safeTarget)}`;
}

export function getLoginRedirectPathForCurrentLocation(): string {
  return getLoginRedirectPath(getCurrentRelativeUrl());
}
