import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import type { BrowserConfig } from './config.js';
import { BrowserWorker } from './process.js';
import { browserOwner } from './scope.js';

interface BrowserSession {
  id: string;
  owner: string;
  config: BrowserConfig;
  worker: BrowserWorker;
  cleanup: Promise<void>;
  retained: boolean;
}

const sessions = new Map<string, BrowserSession>();

type SessionFilter = { owner?: string; ownerRoot?: string; settingsPath?: string };

export async function createBrowserSession(config: BrowserConfig, signal: AbortSignal): Promise<BrowserSession> {
  const cwd = await mkdtemp(join(tmpdir(), 'codeberg-browser-'));
  try {
    signal.throwIfAborted();
    const worker = new BrowserWorker(config, cwd);
    const id = randomUUID();
    const cleanup = worker.closed.then(async () => {
      sessions.delete(id);
      await rm(cwd, { recursive: true, force: true });
    });
    void cleanup.catch(() => console.error('Browser session temporary files could not be removed.'));
    const entry = { id, owner: browserOwner(config), config, worker, cleanup, retained: false };
    sessions.set(id, entry);

    return entry;
  } catch (error) {
    await rm(cwd, { recursive: true, force: true });
    throw error;
  }
}

export function findBrowserSession(config: BrowserConfig, id: string): BrowserSession {
  const entry = sessions.get(id);
  if (!entry || entry.owner !== browserOwner(config) || entry.config.settingsPath !== config.settingsPath)
    throw new Error('Browser session is unavailable. It may have been closed or Codeberg restarted.');

  return entry;
}

export function listBrowserSessions(config: BrowserConfig) {
  return [...sessions.values()].filter((entry) => entry.retained && entry.owner === browserOwner(config) &&
    entry.config.settingsPath === config.settingsPath).map((entry) => ({ session_id: entry.id, busy: entry.worker.busy }));
}

export async function closeBrowserSession(config: BrowserConfig, id: string) {
  await disposeBrowserSession(findBrowserSession(config, id));

  return { status: 'closed' as const, session_id: id };
}

export async function disposeBrowserSession(entry: BrowserSession): Promise<void> {
  await entry.worker.close();
  await entry.cleanup;
}

/** Explicit close, Settings off, chat/project deletion, and shutdown share cleanup. */
export async function closeBrowserSessions(filter: SessionFilter = {}): Promise<void> {
  const selected = [...sessions.values()].filter((entry) =>
    (filter.owner === undefined || entry.owner === filter.owner) &&
    (filter.ownerRoot === undefined || entry.owner.startsWith(filter.ownerRoot + sep)) &&
    (filter.settingsPath === undefined || entry.config.settingsPath === filter.settingsPath));

  await Promise.all(selected.map(disposeBrowserSession));
}
