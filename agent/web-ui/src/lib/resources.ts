import {
  RESOURCE_HISTORY_LIMIT,
  withoutProcesses,
  type CleanupCategory,
  type CleanupPreview,
  type CleanupResult,
  type ResourceSample,
  type ResourceUsage,
} from '@agent/core/api/resources.js';
import { jsonRequest, responseJson } from './response.js';

async function request<T>(path: string, options?: RequestInit, fetcher: typeof fetch = fetch): Promise<T> {
  return responseJson<T>(await fetcher(`/api/settings/${path}`, { cache: 'no-store', ...options }));
}

export const loadResourceUsage = (after?: number, fetcher: typeof fetch = fetch) =>
  request<ResourceUsage>(`resources${after ? `?after=${after}` : ''}`, undefined, fetcher);

export function mergeResourceUsage(previous: ResourceUsage | undefined, incoming: ResourceUsage): ResourceUsage {
  const reset =
    previous?.collector !== incoming.collector ||
    previous?.collectorId !== incoming.collectorId ||
    (previous?.current && incoming.current && previous.current.timestamp > incoming.current.timestamp);
  const points = new Map<number, ResourceSample>();
  if (!reset)
    for (const row of previous?.history ?? [])
      points.set(
        row.timestamp,
        row.timestamp === previous?.current?.timestamp && row.timestamp !== incoming.current?.timestamp
          ? withoutProcesses(row)
          : row,
      );
  for (const row of incoming.history) points.set(row.timestamp, row);
  if (incoming.current) points.set(incoming.current.timestamp, incoming.current);
  const cutoff = (incoming.current?.timestamp ?? Date.now()) - incoming.retentionMs;
  return {
    ...incoming,
    history: [...points.values()]
      .filter((row) => row.timestamp > cutoff)
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-RESOURCE_HISTORY_LIMIT),
  };
}
export const previewCleanup = (days: number, fetcher: typeof fetch = fetch) =>
  request<CleanupPreview>(`cleanup?olderThanDays=${days}`, undefined, fetcher);
export const cleanupResources = (categories: CleanupCategory[], olderThanDays: number, fetcher: typeof fetch = fetch) =>
  request<CleanupResult>(
    'cleanup',
    jsonRequest('POST', { categories, olderThanDays }),
    fetcher,
  );

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`;
}
