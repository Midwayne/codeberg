import { readFile } from 'node:fs/promises';
import type { BrowserConfig } from './config.js';
import type { BrowserTaskOptions } from './protocol.js';
import { closeBrowserSessions, createBrowserSession, disposeBrowserSession, findBrowserSession } from './sessions.js';

const active = new Map<AbortController, { path?: string; done: Promise<unknown> }>();

/** Disabling the global switch cancels active work and closes retained browsers. */
export async function cancelBrowserTasks(path: string): Promise<void> {
  const workers = [...active].filter(([, value]) => value.path === path);
  for (const [controller] of workers) controller.abort();

  await Promise.allSettled(workers.map(([, value]) => value.done));
  await closeBrowserSessions({ settingsPath: path });
}

export async function runBrowserTask(config: BrowserConfig, task: string, signal?: AbortSignal, options: BrowserTaskOptions = {}) {
  if (typeof task !== 'string' || !task.trim() || task.length > 20_000) throw new Error('Browser task must contain 1–20000 characters.');
  if ((options.session_id !== undefined && (typeof options.session_id !== 'string' || !options.session_id)) ||
    (options.keep_open !== undefined && typeof options.keep_open !== 'boolean')) throw new Error('Invalid browser session options.');
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const done = execute(config, task, combined, options);
  active.set(controller, { path: config.settingsPath, done });

  try {
    return await done;
  } finally {
    active.delete(controller);
  }
}

async function execute(config: BrowserConfig, task: string, signal: AbortSignal, options: BrowserTaskOptions) {
  const vision = await requireBrowserPermission(config);
  signal.throwIfAborted();
  if (!options.session_id && !config.supportsVision)
    throw new Error('Browser Use requires a model with vision enabled in models.yml (inputs: [text, vision]).');

  const entry = options.session_id ? findBrowserSession(config, options.session_id) : await createBrowserSession(config, signal);
  if (entry.worker.busy) throw new Error('Browser session is busy. Wait for its current task to finish.');

  const keepOpen = options.keep_open ?? Boolean(options.session_id);
  try {
    const { keepOpen: retained, ...result } = await entry.worker.task(task, keepOpen, signal, vision);
    signal.throwIfAborted();
    entry.retained = keepOpen && retained && result.status !== 'error';
    if (!entry.retained) await disposeBrowserSession(entry);

    return entry.retained ? { ...result, session_id: entry.id, kept_open: true }
      : options.session_id ? { ...result, session_id: entry.id, kept_open: false } : result;
  } catch (error) {
    await disposeBrowserSession(entry);
    throw error;
  }
}

async function requireBrowserPermission(config: BrowserConfig) {
  if (!config.enabled) throw new Error('Browser Use is disabled.');
  if (config.settingsPath) {
    const saved = await readFile(config.settingsPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;

      return undefined;
    });
    if (saved === undefined) return config.vision;

    const value = JSON.parse(saved);
    if (typeof value?.webSearch !== 'boolean' ||
      (value.browserUse !== undefined && typeof value.browserUse !== 'boolean') ||
      (value.browserVision !== undefined && typeof value.browserVision !== 'boolean')) throw new Error('Invalid saved tool settings.');
    if (!(value.browserUse ?? config.enabled)) throw new Error('Browser Use is disabled in Settings → Tools.');

    return value.browserVision ?? config.vision;
  }

  return config.vision;
}
