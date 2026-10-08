import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { writeModuleLog } from '../../module-log.js';
import { scheduleDreaming } from './dreaming.js';
import { reconcileJobs } from './reconciliation.js';
import { refreshKnowledge } from './refresh.js';
import { getSettings, syncWatcher, wakeWorker } from './settings.js';
import type { LearningServiceState } from './state.js';

export function initialize(state: LearningServiceState): Promise<void> {
  state.starting ??= start(state).catch((error: unknown) => {
    state.starting = undefined;
    writeModuleLog('learning-agent', 'initialization_failed', { error: String(error) });
    throw error;
  });

  return state.starting;
}

export async function start(state: LearningServiceState): Promise<void> {
  await getSettings(state);
  await ensureLayout(state);
  await state.queue.reconcileStates();
  await reconcileJobs(state);
  await refreshKnowledge(state);
  await scheduleDreaming(state);
  await state.worker?.initialize();
  await syncWatcher(state);
  state.initialized = true;
  wakeWorker(state);
  if (state.hasGenerator) {
    state.refreshTimer = setInterval(() => {
      if (state.background) return;

      state.background = refreshKnowledge(state)
        .then(() => scheduleDreaming(state))
        .catch((error: unknown) => {
          console.error('knowledge refresh scan failed:', error);
          writeModuleLog('learning-agent', 'refresh_scan_failed', { error: String(error) });
        }).finally(() => {
          state.background = undefined;
        });
    }, 2 * 60_000);
    state.refreshTimer.unref();
  }
}

export function stop(state: LearningServiceState): void {
  state.stopping = true;
  if (state.refreshTimer) clearInterval(state.refreshTimer);

  state.sourceWatcher.stop();
  state.worker?.stop();
}

export async function ensureLayout(state: LearningServiceState): Promise<void> {
  await Promise.all([
    mkdir(join(state.store.root, 'events'), { recursive: true }),
    ...['services', 'flows', 'concepts', 'debugging'].map((name) =>
      mkdir(join(state.store.root, 'knowledge', name), { recursive: true }),
    ),
    ...['pending', 'processing', 'completed', 'failed'].map((name) =>
      mkdir(join(state.store.root, 'jobs', name), { recursive: true }),
    ),
    mkdir(join(state.store.root, 'datasets', 'embedding'), { recursive: true }),
    ...['candidates', 'eval', 'training', 'dismissed'].map((name) =>
      mkdir(join(state.store.root, 'datasets', name), { recursive: true }),
    ),
  ]);
  try {
    const readme = await open(join(state.store.root, 'README.md'), 'wx', 0o600);
    try {
      await readme.writeFile(
        '# Codeberg learning data\n\n' +
          'events/ is the append-only source of truth. Knowledge, jobs, and datasets are derived or retryable.\n',
        'utf8',
      );
      await readme.sync();
    } finally {
      await readme.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}
