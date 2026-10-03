export type CleanupCategory = 'chats' | 'training' | 'knowledge';
export interface ResourceSample {
  timestamp: number;
  cpu: { usedPercent: number | null; corePercent: number | null; cores: number };
  memory: { usedBytes: number; totalBytes: number };
  disk: { totalBytes: number; availableBytes: number; codebergBytes: number; sampledAt?: number } | null;
  processes: { pid: number; name: string; cpuPercent: number | null; memoryBytes: number }[];
  scope: 'managed-stack' | 'web-and-daemon' | 'daemon-process-tree' | 'web-process-tree' | 'web-process';
}
export interface ResourceUsage {
  current: ResourceSample | null;
  history: ResourceSample[];
  retentionMs: number;
  sampleIntervalMs: number;
  diskIntervalMs?: number;
  collector?: 'daemon' | 'worker';
  collectorId?: string;
}
export interface CleanupPreview {
  categories: { category: CleanupCategory; count: number; bytes: number }[];
}
export interface CleanupResult {
  deleted: number;
  failed: number;
  bytesFreed: number;
  deletedChatIds: string[];
}

async function request<T>(path: string, options?: RequestInit, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(`/api/settings/${path}`, { cache: 'no-store', ...options });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export const loadResourceUsage = (after?: number, fetcher: typeof fetch = fetch) => request<ResourceUsage>(`resources${after ? `?after=${after}` : ''}`, undefined, fetcher);

/** Keep a bounded local history while subsequent polls transfer only new points. */
export function mergeResourceUsage(previous: ResourceUsage | undefined, incoming: ResourceUsage): ResourceUsage {
  const reset = previous?.collector !== incoming.collector || previous?.collectorId !== incoming.collectorId ||
    (previous?.current && incoming.current && previous.current.timestamp > incoming.current.timestamp);
  const points = new Map<number, ResourceSample>();
  if (!reset) for (const row of previous?.history ?? []) points.set(row.timestamp,
    row.timestamp === previous?.current?.timestamp && row.timestamp !== incoming.current?.timestamp ? { ...row, processes: [] } : row);
  for (const row of incoming.history) points.set(row.timestamp, row);
  if (incoming.current) points.set(incoming.current.timestamp, incoming.current);
  const cutoff = (incoming.current?.timestamp ?? Date.now()) - incoming.retentionMs;
  return { ...incoming, history: [...points.values()].filter((row) => row.timestamp > cutoff)
    .sort((a, b) => a.timestamp - b.timestamp).slice(-360) };
}
export const previewCleanup = (days: number, fetcher: typeof fetch = fetch) => request<CleanupPreview>(`cleanup?olderThanDays=${days}`, undefined, fetcher);
export const cleanupResources = (categories: CleanupCategory[], olderThanDays: number, fetcher: typeof fetch = fetch) => request<CleanupResult>('cleanup', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categories, olderThanDays }),
}, fetcher);

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`;
}
