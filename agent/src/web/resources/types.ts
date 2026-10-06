import type { ProcessUsage } from '../process-resources.js';

export const CLEANUP_CATEGORIES = ['chats', 'training', 'knowledge'] as const;

export type CleanupCategory = (typeof CLEANUP_CATEGORIES)[number];

export interface ResourceSample extends ProcessUsage {
  timestamp: number;
  disk: {
    totalBytes: number;
    availableBytes: number;
    codebergBytes: number;
    sampledAt?: number;
  } | null;
}

export interface StoredFile {
  path: string;
  id: string;
  age: number;
  size: number;
  ino: number;
  mtimeMs: number;
}

export class ResourceSettingsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
