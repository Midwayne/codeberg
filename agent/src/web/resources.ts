import { constants } from 'node:fs';
import { lstat, open, readdir, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { codebergHome } from '../core/paths.js';
import { writeModuleLog } from '../core/module-log.js';
import { DatasetStore } from '../core/learning/datasets.js';
import type { LearningService } from '../core/learning/service.js';
import { defaultLearningRoot, LearningStore, parseArtifact } from '../core/learning/store.js';
import { isValidSessionId, type WebSessionStore } from './sessions/store.js';
import type { ProcessUsage } from './process-resources.js';
import { ResourceMonitorClient, type ResourceReader } from './resource-monitor.js';

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

interface StoredFile {
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

/** Narrowly scoped cleanup and a cached metrics transport; collection is isolated. */
export class ResourceSettings {
  private readonly home: string;
  private readonly learningRoot: string;
  private readonly monitor: ResourceReader;
  private readonly env: NodeJS.ProcessEnv;
  busy = false;

  constructor(
    private readonly options: {
      home?: string;
      sessions: WebSessionStore;
      learning?: LearningService;
      daemonUrl?: string;
      env?: NodeJS.ProcessEnv;
      monitor?: ResourceReader;
    },
  ) {
    this.env = options.env ?? process.env;
    this.home = resolve(options.home ?? codebergHome(this.env));
    this.learningRoot = resolve(
      options.learning?.store.root ??
        defaultLearningRoot({ ...this.env, CODEBERG_HOME: this.home }),
    );
    this.monitor =
      options.monitor ??
      new ResourceMonitorClient({
        home: this.home,
        sessionsDir: options.sessions.dir,
        learningRoot: this.learningRoot,
        env: this.env,
        daemonUrl: options.daemonUrl ?? this.env.CODEBERG_DAEMON_URL,
      });
  }

  start(): void {
    this.monitor.start();
  }

  stop(): void {
    this.monitor.stop();
  }

  usage(after = 0) {
    return this.monitor.read(after);
  }

  async preview(olderThanDays: unknown) {
    const cutoff = ageCutoff(olderThanDays);
    const categories = await Promise.all(
      CLEANUP_CATEGORIES.map(async (category) => {
        const files = await this.files(category, cutoff);

        return {
          category,
          count: files.length,
          bytes: files.reduce((sum, file) => sum + file.size, 0),
        };
      }),
    );

    return { categories, cutoff, olderThanDays };
  }

  async cleanup(input: unknown) {
    const body = input as { categories?: unknown; olderThanDays?: unknown } | null;
    const cutoff = ageCutoff(body?.olderThanDays);
    if (
      !Array.isArray(body?.categories) ||
      !body.categories.length ||
      body.categories.some((value) => !CLEANUP_CATEGORIES.includes(value)) ||
      new Set(body.categories).size !== body.categories.length
    ) {
      throw new ResourceSettingsError('Select one or more valid cleanup categories.');
    }

    const categories = body.categories as CleanupCategory[];
    if (this.busy) throw new ResourceSettingsError('Cleanup is already running.', 409);

    this.busy = true;
    const remove = () => this.removeFiles(categories, cutoff);

    try {
      const locked = async () =>
        (await realDirectory(join(this.learningRoot, 'datasets'), this.learningRoot))
          ? new DatasetStore(
              this.options.learning?.store ?? new LearningStore(this.learningRoot),
            ).withPromotionLock(remove)
          : remove();

      const action = categories.includes('training') ? locked : remove;

      return this.options.learning && categories.some((category) => category !== 'chats')
        ? await this.options.learning.withMaintenance(action)
        : await action();
    } catch (error) {
      if (/learning is busy|promotion in progress/.test(String(error)))
        throw new ResourceSettingsError(
          'Learning is busy. Try cleanup again after background jobs finish.',
          409,
        );

      throw error;
    } finally {
      this.busy = false;
    }
  }

  private async removeFiles(categories: CleanupCategory[], cutoff: number) {
    let deleted = 0;
    let bytesFreed = 0;
    let failed = 0;
    const deletedChatIds: string[] = [];
    // Establish all target lists before the first deletion, so discovery errors
    // cannot leave the client unaware of a partially deleted earlier category.
    const targets = await Promise.all(
      categories.map(async (category) => ({ category, files: await this.files(category, cutoff) })),
    );
    for (const { category, files } of targets) {
      for (const file of files) {
        try {
          if (category === 'chats') {
            const size = await this.options.sessions.removeOlder(file.id, cutoff);
            if (size !== undefined) {
              deleted++;
              bytesFreed += size;
              deletedChatIds.push(file.id);
            }
          } else {
            const current = await fileInfo(file.path);
            if (
              !current ||
              current.ino !== file.ino ||
              current.mtimeMs !== file.mtimeMs ||
              current.size !== file.size
            )
              continue;

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

    this.monitor.invalidateDisk();

    return { deleted, failed, bytesFreed, categories, deletedChatIds };
  }

  private async files(category: CleanupCategory, cutoff: number): Promise<StoredFile[]> {
    const files: StoredFile[] = [];
    const dirs =
      category === 'chats'
        ? [this.options.sessions.dir]
        : category === 'training'
          ? ['candidates', 'training', 'eval', 'dismissed'].map((bucket) =>
              join(this.learningRoot, 'datasets', bucket),
            )
          : ['services', 'flows', 'concepts', 'debugging'].map((bucket) =>
              join(this.learningRoot, 'knowledge', bucket),
            );

    for (const dir of dirs) {
      if (
        !(await realDirectory(
          dir,
          category === 'chats' ? this.options.sessions.dir : this.learningRoot,
        ))
      )
        continue;

      for (const name of await readdir(dir)) {
        if (!name.endsWith(category === 'knowledge' ? '.md' : '.json')) continue;

        const path = join(dir, name);
        const file = await readStoredFile(path, name, category);
        if (file) files.push(file);
      }
    }

    if (category === 'knowledge') files.push(...(await this.dreamingFiles()));

    // Candidate and review copies form a family: preserve all if any copy was recently reviewed.
    const newest = new Map<string, number>();
    for (const file of files) newest.set(file.id, Math.max(newest.get(file.id) ?? 0, file.age));

    return files.filter((file) => (newest.get(file.id) ?? Infinity) < cutoff);
  }

  /** A report and its decision receipts form one age-filtered knowledge revision family. */
  private async dreamingFiles(): Promise<StoredFile[]> {
    const dir = join(this.learningRoot, 'dreaming');
    if (!(await realDirectory(dir, this.learningRoot))) return [];

    const files: StoredFile[] = [];
    const add = async (path: string, id: string, receipt: boolean) => {
      const info = await fileInfo(path);
      if (!info) return;

      try {
        const record = JSON.parse(await readRegularFile(path));
        const age = Date.parse(receipt ? record.decisions?.at(-1)?.timestamp : record.created_at);
        if (!Number.isFinite(age)) return;

        files.push({ path, id, age, size: info.size, ino: info.ino, mtimeMs: info.mtimeMs });
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code &&
          !['ENOENT', 'ELOOP'].includes((error as NodeJS.ErrnoException).code!)
        )
          throw error;
      }
    };

    for (const name of await readdir(dir)) {
      if (/^dream-[a-z0-9-]{1,70}\.json$/.test(name))
        await add(join(dir, name), name.slice(0, -5), false);

      if (
        !/^dream-[a-z0-9-]{1,70}$/.test(name) ||
        !(await realDirectory(join(dir, name), this.learningRoot))
      )
        continue;

      for (const revision of await readdir(join(dir, name))) {
        if (/^\d{8}\.json$/.test(revision)) await add(join(dir, name, revision), name, true);
      }
    }

    return files;
  }
}

async function readStoredFile(
  path: string,
  name: string,
  category: CleanupCategory,
): Promise<StoredFile | undefined> {
  const info = await fileInfo(path);
  if (!info) return undefined;

  try {
    const raw = await readRegularFile(path);
    const record = category === 'knowledge' ? parseArtifact(raw) : JSON.parse(raw);
    const id = name.slice(0, -5);
    if (category === 'chats' && (!isValidSessionId(id) || record.id !== id || record.pinned))
      return undefined;

    const age =
      category === 'chats'
        ? record.updatedAt
        : Date.parse(
            category === 'training'
              ? (record.review?.timestamp ?? record.extracted_at)
              : record.updated_at,
          );

    if (!Number.isFinite(age)) return undefined;

    return {
      path,
      id: category === 'chats' ? id : name,
      age,
      size: info.size,
      ino: info.ino,
      mtimeMs: info.mtimeMs,
    };
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code &&
      !['ENOENT', 'ELOOP'].includes((error as NodeJS.ErrnoException).code!)
    )
      throw error;
    // Malformed records cannot establish an age and are not cleanup targets.
  }

  return undefined;
}

function ageCutoff(days: unknown): number {
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > 36500)
    throw new ResourceSettingsError('Age must be a whole number of days between 0 and 36500.');

  return days === 0 ? Infinity : Date.now() - days * 86_400_000;
}

async function fileInfo(path: string) {
  try {
    const info = await lstat(path);

    return info.isFile() ? info : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;

    throw error;
  }
}

async function realDirectory(path: string, boundary: string): Promise<boolean> {
  try {
    if (!(await lstat(path)).isDirectory()) return false;

    const parent = dirname(path);

    return path === boundary || parent === path || (await realDirectory(parent, boundary));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;

    throw error;
  }
}

async function readRegularFile(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile()) throw new Error('not a regular file');

    return await file.readFile('utf8');
  } finally {
    await file.close();
  }
}
