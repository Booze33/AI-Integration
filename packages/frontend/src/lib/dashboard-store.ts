import { DashboardStats } from './api-client';

const DASHBOARD_CACHE_TTL_MS = 60_000;

interface DashboardCacheState {
  stats: DashboardStats | null;
  cachedAt: number | null;
}

const dashboardCacheState: DashboardCacheState = {
  stats: null,
  cachedAt: null,
};

export function getCachedDashboardStats(): DashboardStats | null {
  if (!dashboardCacheState.stats || !dashboardCacheState.cachedAt) {
    return null;
  }

  const ageMs = Date.now() - dashboardCacheState.cachedAt;
  if (ageMs > DASHBOARD_CACHE_TTL_MS) {
    dashboardCacheState.stats = null;
    dashboardCacheState.cachedAt = null;
    return null;
  }

  return dashboardCacheState.stats;
}

export function setCachedDashboardStats(stats: DashboardStats): void {
  dashboardCacheState.stats = stats;
  dashboardCacheState.cachedAt = Date.now();
}

export function clearCachedDashboardStats(): void {
  dashboardCacheState.stats = null;
  dashboardCacheState.cachedAt = null;
}
