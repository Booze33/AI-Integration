import { appConfig } from '../config';

const REQUEST_ID_HEADER = 'X-Request-ID';
const RESPONSE_REQUEST_ID_HEADERS = ['x-request-id', 'x-correlation-id'];
const MAX_REQUEST_ID_HISTORY = 10;

const recentRequestIds: string[] = [];
let lastRequestId: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

export class ApiClientError extends Error {
  public statusCode: number;
  public requestId: string | null;

  constructor(message: string, statusCode = 500, requestId: string | null = null) {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.requestId = requestId;
  }
}

export function getLastRequestId(): string | null {
  return lastRequestId;
}

export function getRecentRequestIds(): string[] {
  return [...recentRequestIds];
}

function rememberRequestId(id: string | null | undefined) {
  if (!id) return;

  lastRequestId = id;
  recentRequestIds.push(id);
  if (recentRequestIds.length > MAX_REQUEST_ID_HISTORY) {
    recentRequestIds.splice(0, recentRequestIds.length - MAX_REQUEST_ID_HISTORY);
  }
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function resolveUrl(input: string): string {
  if (/^https?:\/\//i.test(input)) {
    return input;
  }

  if (typeof window !== 'undefined') {
    return new URL(input, window.location.origin).toString();
  }

  return new URL(input, appConfig.apiUrl).toString();
}

function cloneHeaders(headers?: HeadersInit): Headers {
  return new Headers(headers || {});
}

async function performFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const requestId = createRequestId();
  const headers = cloneHeaders(init.headers);
  headers.set(REQUEST_ID_HEADER, requestId);

  const response = await fetch(resolveUrl(input), {
    ...init,
    headers,
    credentials: 'include',
  });

  const responseRequestId = RESPONSE_REQUEST_ID_HEADERS.map((header) =>
    response.headers.get(header)
  ).find((value) => !!value);

  rememberRequestId(responseRequestId || requestId);
  return response;
}

function clearLocalAuthState() {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem('chatHistory');
    sessionStorage.clear();
  } catch {
    // ignore storage errors
  }
}

function redirectToLogin() {
  if (typeof window === 'undefined') return;
  if (window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
}

async function refreshAuthSession(): Promise<boolean> {
  if (typeof window === 'undefined') {
    return false;
  }

  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await performFetch('/api/auth/refresh', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        return response.ok;
      } catch {
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
  }

  return refreshPromise;
}

interface ApiFetchOptions {
  retryOnUnauthorized?: boolean;
}

export async function apiFetch(
  input: string,
  init: RequestInit = {},
  options: ApiFetchOptions = {}
): Promise<Response> {
  const retryOnUnauthorized = options.retryOnUnauthorized ?? true;

  const first = await performFetch(input, init);
  if (first.status !== 401 || !retryOnUnauthorized) {
    return first;
  }

  const refreshed = await refreshAuthSession();
  if (!refreshed) {
    clearLocalAuthState();
    redirectToLogin();
    return first;
  }

  const retry = await performFetch(input, init);
  if (retry.status === 401) {
    clearLocalAuthState();
    redirectToLogin();
  }

  return retry;
}

export async function apiJson<T>(
  input: string,
  init: RequestInit = {},
  options: ApiFetchOptions = {}
): Promise<T> {
  const response = await apiFetch(input, init, options);
  const requestId = getLastRequestId();

  if (!response.ok) {
    let message = `HTTP ${response.status}: ${response.statusText}`;

    try {
      const errorData = await response.json();
      message = errorData?.error || errorData?.message || message;
    } catch {
      // ignore parsing errors
    }

    if (requestId) {
      message = `${message} (Request ID: ${requestId})`;
    }

    throw new ApiClientError(message, response.status, requestId);
  }

  if (response.status === 204) {
    return {} as T;
  }

  try {
    return (await response.json()) as T;
  } catch {
    const message = requestId
      ? `Invalid JSON response (Request ID: ${requestId})`
      : 'Invalid JSON response';
    throw new ApiClientError(message, response.status, requestId);
  }
}
