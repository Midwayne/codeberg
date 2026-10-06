import { watch, type FSWatcher } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';

import { writeModuleLog } from '../module-log.js';
import { sourceKey } from './memory-source.js';
import type { LearningStore } from './store.js';
import type { RepositoryVersion } from './types.js';

type WatchedFiles = Map<string, Set<string>>;

type DirectoryWatch = { watcher: FSWatcher; files: WatchedFiles };

const MAX_WATCHERS = 256;

/** Best-effort notifications for cited files. The durable periodic scan handles missed events. */
export class KnowledgeSourceWatcher {
  private readonly directories = new Map<string, DirectoryWatch>();
  private stopped = false;

  constructor(
    private readonly store: LearningStore,
    private readonly onChange: (sources: Set<string>) => void,
  ) {}

  async sync(): Promise<void> {
    if (this.stopped) return;

    const [artifacts, repositories] = await Promise.all([
      this.store.knowledgeArtifacts(),
      this.store.repositories(),
    ]);

    const desired = new Map<string, WatchedFiles>();

    for (const ref of artifacts.flatMap((artifact) => artifact.source_refs ?? [])) {
      const directory = await sourceDirectory(ref.repo, ref.path, repositories);
      if (!directory) continue;

      const files = desired.get(directory) ?? new Map<string, Set<string>>();
      const filename = basename(ref.path);
      const sources = files.get(filename) ?? new Set<string>();
      sources.add(sourceKey(ref));
      files.set(filename, sources);
      desired.set(directory, files);
    }

    if (this.stopped) return;

    this.updateExisting(desired);
    this.watchNewDirectories(desired);
  }

  resume(): void {
    this.stopped = false;
  }

  stop(): void {
    this.stopped = true;
    for (const { watcher } of this.directories.values()) watcher.close();

    this.directories.clear();
  }

  private updateExisting(desired: Map<string, WatchedFiles>): void {
    for (const [directory, current] of this.directories) {
      const files = desired.get(directory);
      if (files) {
        current.files = files;
      } else {
        current.watcher.close();
        this.directories.delete(directory);
      }
    }
  }

  private watchNewDirectories(desired: Map<string, WatchedFiles>): void {
    for (const [directory, files] of desired) {
      if (this.directories.has(directory) || this.directories.size >= MAX_WATCHERS) continue;

      try {
        const watcher = watch(directory, { persistent: false }, (_event, filename) => {
          const watchedFiles = this.directories.get(directory)?.files;
          if (!watchedFiles) return;

          const changed = filename
            ? watchedFiles.get(String(filename))
            : new Set([...watchedFiles.values()].flatMap((sources) => [...sources]));
          if (changed?.size) this.onChange(changed);
        });

        watcher.on('error', (error) => {
          this.directories.delete(directory);
          watcher.close();
          console.error('knowledge source watcher failed:', error);
          writeModuleLog('learning-agent', 'source_watcher_failed', { error: String(error) });
        });
        this.directories.set(directory, { watcher, files });
      } catch {
        // Unsupported watches are covered by the periodic repository scan.
      }
    }
  }
}

async function sourceDirectory(
  repoPath: string,
  filePath: string,
  repositories: RepositoryVersion[],
): Promise<string | undefined> {
  if (!repositories.some((repository) => repository.path === repoPath)) return undefined;

  const root = await realpath(repoPath).catch(() => undefined);
  if (!root) return undefined;

  const directory = await realpath(dirname(resolve(root, filePath))).catch(() => undefined);
  if (directory === root || directory?.startsWith(`${root}${sep}`)) return directory;

  return undefined;
}
