import { constants, type StatsFs } from 'node:fs';
import { lstat, open, readdir, statfs, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { codebergHome } from '../core/paths.js';
import { writeModuleLog } from '../core/module-log.js';
import { DatasetStore } from '../core/learning/datasets.js';
import type { LearningService } from '../core/learning/service.js';
import { defaultLearningRoot, LearningStore, parseArtifact } from '../core/learning/store.js';
import { isValidSessionId, type WebSessionStore } from './sessions/store.js';
import { ProcessMonitor, type ProcessUsage } from './process-resources.js';

const HOUR = 60 * 60_000;
export const RESOURCE_SAMPLE_MS = 10_000;
export const CLEANUP_CATEGORIES = ['chats', 'training', 'knowledge'] as const;
export type CleanupCategory = typeof CLEANUP_CATEGORIES[number];

export interface ResourceSample extends ProcessUsage {
  timestamp: number;
  disk: { totalBytes: number; availableBytes: number; codebergBytes: number } | null;
}

interface StoredFile {
  path: string;
  id: string;
  age: number;
  size: number;
  ino: number;
  mtimeMs: number;
}

export class ResourceSettingsError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** Local monitoring and narrowly scoped cleanup; paths never come from the client. */
export class ResourceSettings {
  private readonly home: string;
  private readonly learningRoot: string;
  private history: ResourceSample[] = [];
  private readonly processMonitor: ProcessMonitor;
  private readonly env: NodeJS.ProcessEnv;
  private disk: ResourceSample['disk'] = null;
  private diskSampledAt = -Infinity;
  private sampling?: Promise<void>;
  private timer?: NodeJS.Timeout;
  busy = false;

  constructor(private readonly options: {
    home?: string;
    sessions: WebSessionStore;
    learning?: LearningService;
    daemonUrl?: string;
    env?: NodeJS.ProcessEnv;
    processMonitor?: ProcessMonitor;
  }) {
    this.env = options.env ?? process.env;
    this.home = resolve(options.home ?? codebergHome(this.env));
    this.learningRoot = resolve(options.learning?.store.root ?? defaultLearningRoot({ ...this.env, CODEBERG_HOME: this.home }));
    this.processMonitor = options.processMonitor ?? new ProcessMonitor({
      launcherPid: Number(this.env.CODEBERG_RESOURCE_ROOT_PID) || undefined,
      daemonUrl: options.daemonUrl ?? this.env.CODEBERG_DAEMON_URL,
    });
  }

  start(): void {
    if (this.timer) return;
    void this.sample().catch(() => undefined);
    this.timer = setInterval(() => { void this.sample().catch(() => undefined); }, RESOURCE_SAMPLE_MS);
    this.timer.unref();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  usage() {
    return { current: this.history.at(-1) ?? null, history: [...this.history], retentionMs: HOUR, sampleIntervalMs: RESOURCE_SAMPLE_MS };
  }

  sample(timestamp = Date.now()): Promise<void> {
    this.sampling ??= this.collect(timestamp).finally(() => { this.sampling = undefined; });
    return this.sampling;
  }

  private async collect(timestamp: number): Promise<void> {
    const sample: ResourceSample = { ...await this.processMonitor.sample(), timestamp, disk: null };
    if (timestamp - this.diskSampledAt >= 60_000) {
      try {
        const fs = await filesystem(this.home);
        this.disk = {
          totalBytes: fs.blocks * fs.bsize,
          availableBytes: fs.bavail * fs.bsize,
          codebergBytes: await this.storageBytes(),
        };
      } catch { this.disk = null; }
      this.diskSampledAt = timestamp;
    }
    sample.disk = this.disk;
    this.history = [...this.history.filter((row) => row.timestamp > timestamp - HOUR), sample].slice(-360);
  }

  private async storageBytes(): Promise<number> {
    const paths = [this.home, this.options.sessions.dir, this.learningRoot];
    if (this.env.CODEBERG_LOG_DIR) paths.push(this.env.CODEBERG_LOG_DIR);
    if (this.env.CBERG_MODEL) {
      paths.push(this.env.CBERG_MODEL);
      for (const name of ['tokenizer.json', 'vocab.txt', 'tokenizer_config.json', 'special_tokens_map.json']) {
        paths.push(join(dirname(this.env.CBERG_MODEL), name));
      }
    }
    if (this.env.CBERG_INDEX_PATH) {
      const base = resolve(this.env.CBERG_INDEX_PATH);
      const dir = dirname(base);
      const stem = basename(base);
      let names: string[] = [];
      try { names = await readdir(dir); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      paths.push(...names.filter((name) => name === stem || name.startsWith(stem + '.')).map((name) => join(dir, name)));
    }
    const visited = new Set<string>();
    let bytes = 0;
    for (const path of paths) bytes += await directoryBytes(resolve(path), visited);
    return bytes;
  }

  async preview(olderThanDays: unknown) {
    const cutoff = ageCutoff(olderThanDays);
    const categories = await Promise.all(CLEANUP_CATEGORIES.map(async (category) => {
      const files = await this.files(category, cutoff);
      return { category, count: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0) };
    }));
    return { categories, cutoff, olderThanDays };
  }

  async cleanup(input: unknown) {
    const body = input as { categories?: unknown; olderThanDays?: unknown } | null;
    const cutoff = ageCutoff(body?.olderThanDays);
    if (!Array.isArray(body?.categories) || !body.categories.length ||
      body.categories.some((value) => !CLEANUP_CATEGORIES.includes(value)) || new Set(body.categories).size !== body.categories.length) {
      throw new ResourceSettingsError('Select one or more valid cleanup categories.');
    }
    const categories = body.categories as CleanupCategory[];
    if (this.busy) throw new ResourceSettingsError('Cleanup is already running.', 409);
    this.busy = true;
    const remove = async () => {
      let deleted = 0;
      let bytesFreed = 0;
      let failed = 0;
      const deletedChatIds: string[] = [];
      // Establish all target lists before the first deletion, so discovery errors
      // cannot leave the client unaware of a partially deleted earlier category.
      const targets = await Promise.all(categories.map(async (category) => ({ category, files: await this.files(category, cutoff) })));
      for (const { category, files } of targets) {
        for (const file of files) {
          try {
            if (category === 'chats') {
              const size = await this.options.sessions.removeOlder(file.id, cutoff);
              if (size !== undefined) { deleted++; bytesFreed += size; deletedChatIds.push(file.id); }
            } else {
              const current = await fileInfo(file.path);
              if (!current || current.ino !== file.ino || current.mtimeMs !== file.mtimeMs || current.size !== file.size) continue;
              await unlink(file.path);
              deleted++;
              bytesFreed += file.size;
            }
          } catch (error) {
            failed++;
            writeModuleLog('agent', 'cleanup_file_failed', { category, error: String(error) });
          }
        }
      }
      this.diskSampledAt = -Infinity;
      return { deleted, failed, bytesFreed, categories, deletedChatIds };
    };
    try {
      const locked = async () => await realDirectory(join(this.learningRoot, 'datasets'), this.learningRoot)
        ? new DatasetStore(this.options.learning?.store ?? new LearningStore(this.learningRoot)).withPromotionLock(remove)
        : remove();
      const action = categories.includes('training') ? locked : remove;
      return this.options.learning && categories.some((category) => category !== 'chats')
        ? await this.options.learning.withMaintenance(action) : await action();
    } catch (error) {
      if (/learning is busy|promotion in progress/.test(String(error))) throw new ResourceSettingsError('Learning is busy. Try cleanup again after background jobs finish.', 409);
      throw error;
    } finally { this.busy = false; }
  }

  private async files(category: CleanupCategory, cutoff: number): Promise<StoredFile[]> {
    const files: StoredFile[] = [];
    const dirs = category === 'chats' ? [this.options.sessions.dir]
      : category === 'training' ? ['candidates', 'training', 'eval', 'dismissed'].map((bucket) => join(this.learningRoot, 'datasets', bucket))
      : ['services', 'flows', 'concepts', 'debugging'].map((bucket) => join(this.learningRoot, 'knowledge', bucket));
    for (const dir of dirs) {
      if (!await realDirectory(dir, category === 'chats' ? this.options.sessions.dir : this.learningRoot)) continue;
      for (const name of await readdir(dir)) {
        if (!name.endsWith(category === 'knowledge' ? '.md' : '.json')) continue;
        const path = join(dir, name);
        const info = await fileInfo(path);
        if (!info) continue;
        try {
          const raw = await readRegularFile(path);
          const record = category === 'knowledge' ? parseArtifact(raw) : JSON.parse(raw);
          const id = name.slice(0, -5);
          if (category === 'chats' && (!isValidSessionId(id) || record.id !== id || record.pinned)) continue;
          const age = category === 'chats' ? record.updatedAt : Date.parse(category === 'training'
            ? record.review?.timestamp ?? record.extracted_at : record.updated_at);
          if (!Number.isFinite(age)) continue;
          files.push({ path, id: category === 'chats' ? id : name, age, size: info.size, ino: info.ino, mtimeMs: info.mtimeMs });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code && !['ENOENT', 'ELOOP'].includes((error as NodeJS.ErrnoException).code!)) throw error;
          // Malformed records cannot establish an age and are not cleanup targets.
        }
      }
    }
    // Candidate and review copies form a family: preserve all if any copy was recently reviewed.
    const newest = new Map<string, number>();
    for (const file of files) newest.set(file.id, Math.max(newest.get(file.id) ?? 0, file.age));
    return files.filter((file) => (newest.get(file.id) ?? Infinity) < cutoff);
  }
}

function ageCutoff(days: unknown): number {
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > 36500) throw new ResourceSettingsError('Age must be a whole number of days between 0 and 36500.');
  return days === 0 ? Infinity : Date.now() - days * 86_400_000;
}

async function fileInfo(path: string) {
  try { const info = await lstat(path); return info.isFile() ? info : undefined; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

async function realDirectory(path: string, boundary: string): Promise<boolean> {
  try {
    if (!(await lstat(path)).isDirectory()) return false;
    const parent = dirname(path);
    return path === boundary || parent === path || await realDirectory(parent, boundary);
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

async function readRegularFile(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { if (!(await file.stat()).isFile()) throw new Error('not a regular file'); return await file.readFile('utf8'); }
  finally { await file.close(); }
}

async function directoryBytes(path: string, visited: Set<string>): Promise<number> {
  let info;
  try { info = await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
  if (!info.isFile() && !info.isDirectory()) return 0;
  const key = `${info.dev}:${info.ino}`;
  if (visited.has(key)) return 0;
  visited.add(key);
  if (info.isFile()) return info.blocks * 512;
  let size = 0;
  for (const name of await readdir(path)) size += await directoryBytes(join(path, name), visited);
  return size;
}

async function filesystem(path: string): Promise<StatsFs> {
  try { return await statfs(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(path) === path) throw error; return filesystem(dirname(path)); }
}
