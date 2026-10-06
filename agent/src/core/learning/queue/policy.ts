import type { FailureCategory } from '../types.js';

export const DEFAULT_LEASE_MS = 10 * 60_000;

export const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 4 * 60 * 60_000];

export const MAX_ATTEMPTS = 5;

export function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;

  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export function isTransientFailure(category: FailureCategory): boolean {
  return category !== 'PERMANENT_ERROR';
}

export function classifyFailure(error: unknown): FailureCategory {
  const text = String(error).toLowerCase();
  if (/permanent_error/.test(text)) return 'PERMANENT_ERROR';

  if (/rate.?limit|\b429\b/.test(text)) return 'RATE_LIMITED';

  if (/network|fetch failed|econn|enotfound|timeout|offline/.test(text)) return 'NETWORK_ERROR';

  if (/repository|enoent/.test(text)) return 'REPOSITORY_UNAVAILABLE';

  if (/invalid[_ ]response|invalid json|schema/.test(text)) return 'INVALID_RESPONSE';

  return 'MODEL_ERROR';
}
