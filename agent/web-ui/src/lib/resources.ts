export type CleanupCategory = 'chats' | 'training' | 'knowledge';
export interface ResourceSample {
  timestamp: number;
  cpu: { usedPercent: number | null; corePercent: number | null; cores: number };
  memory: { usedBytes: number; totalBytes: number };
  disk: { totalBytes: number; availableBytes: number; codebergBytes: number } | null;
  processes: { pid: number; name: string; cpuPercent: number | null; memoryBytes: number }[];
  scope: 'managed-stack' | 'web-and-daemon' | 'web-process-tree' | 'web-process';
}
export interface ResourceUsage {
  current: ResourceSample | null;
  history: ResourceSample[];
  retentionMs: number;
  sampleIntervalMs: number;
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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/settings/${path}`, { cache: 'no-store', ...options });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export const loadResourceUsage = () => request<ResourceUsage>('resources');
export const previewCleanup = (days: number) => request<CleanupPreview>(`cleanup?olderThanDays=${days}`);
export const cleanupResources = (categories: CleanupCategory[], olderThanDays: number) => request<CleanupResult>('cleanup', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categories, olderThanDays }),
});

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`;
}
