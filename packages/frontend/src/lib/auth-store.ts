export interface AuthUser {
  id: string;
  email: string;
  role: string;
  tenantId?: string;
  createdAt?: string;
}

export interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  initialized: boolean;
}

let state: AuthState = {
  user: null,
  isAuthenticated: false,
  initialized: false,
};

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function getAuthState(): AuthState {
  return state;
}

export function setAuthUser(user: AuthUser | null) {
  state = {
    user,
    isAuthenticated: Boolean(user),
    initialized: true,
  };
  notify();
}

export function clearAuthState(initialized = true) {
  state = {
    user: null,
    isAuthenticated: false,
    initialized,
  };
  notify();
}

export function subscribeAuthState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
