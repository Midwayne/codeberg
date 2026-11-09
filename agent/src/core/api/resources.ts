export const CLEANUP_CATEGORIES = ['chats', 'training', 'knowledge'] as const;

export type CleanupCategory = (typeof CLEANUP_CATEGORIES)[number];

/** Collection cadence; the daemon collector uses the same values. */
export const RESOURCE_SAMPLE_MS = 10_000;
export const RESOURCE_DISK_MS = 5 * 60_000;
export const RESOURCE_RETENTION_MS = 60 * 60_000;
export const RESOURCE_HISTORY_LIMIT = RESOURCE_RETENTION_MS / RESOURCE_SAMPLE_MS;

export type ResourceScope =
  | 'managed-stack'
  | 'web-and-daemon'
  | 'daemon-process-tree'
  | 'web-process-tree'
  | 'web-process';

export interface ProcessUsage {
  cpu: { usedPercent: number | null; corePercent: number | null; cores: number };
  memory: { usedBytes: number; totalBytes: number };
  processes: { pid: number; name: string; cpuPercent: number | null; memoryBytes: number }[];
  scope: ResourceScope;
}

export interface ResourceSample extends ProcessUsage {
  timestamp: number;
  disk: {
    totalBytes: number;
    availableBytes: number;
    codebergBytes: number;
    sampledAt?: number;
  } | null;
}

/** `GET /api/settings/resources`; only `current` keeps its process list. */
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
  cutoff: number;
  olderThanDays: unknown;
}

export interface CleanupResult {
  deleted: number;
  failed: number;
  bytesFreed: number;
  categories: CleanupCategory[];
  deletedChatIds: string[];
}

/** History rows carry no process list; only the newest sample does. */
export function withoutProcesses(sample: ResourceSample): ResourceSample {
  return { ...sample, processes: [] };
}
