import type { ProjectCatalog } from '../../core/projects.js';
import type { ProjectRequestRouterState } from './state.js';

export class ProjectServiceTimeout extends Error {
  readonly status = 504;

  constructor(method: string) {
    super(method === 'GET'
      ? 'Project service did not respond in time. Codeberg may be busy indexing. Try again shortly.'
      : 'Project operation did not respond in time and may still complete. Refresh projects before retrying.');
  }
}

/** The daemon is not accepting connections: it is still starting or was restarted. */
export class ProjectServiceUnreachable extends Error {
  readonly status = 502;

  constructor() {
    super('Project service is not reachable. It may still be starting; Codeberg retries automatically.');
  }
}

/**
 * How long a page load waits for the daemon's project list before using the
 * last one it reported. A busy daemon must not hold every screen behind it.
 */
export const CATALOG_READ_TIMEOUT_MS = 1500;

/** Bound the complete response, release the timer, and never replay mutations. */
export async function requestProjectService(base: string, path: string, init: RequestInit = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ProjectServiceTimeout(init.method ?? 'GET')), timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;

  try {
    signal.throwIfAborted();
    const response = await fetch(new URL(path, base), { ...init, signal });
    const body = await response.json();

    return { response, body };
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;

    // fetch rejects with a TypeError only when no HTTP exchange took place.
    if (error instanceof TypeError && !signal.aborted) throw new ProjectServiceUnreachable();

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function daemon(
  state: ProjectRequestRouterState,
  path: string,
  init?: RequestInit,
  timeoutMs?: number,
) {
  const { response, body } = await requestProjectService(state.options.daemonUrl, path, init, timeoutMs);
  if (!response.ok) throw new Error(body.message ?? 'Project service unavailable');

  return body;
}

/**
 * Reads the project list for a page load. The projects seldom change, so when
 * the daemon is busy or restarting the last list it reported is served at once;
 * project status polling reports the underlying problem separately.
 */
export async function readCatalog(state: ProjectRequestRouterState): Promise<ProjectCatalog> {
  try {
    return await daemon(state, '/projects', undefined, CATALOG_READ_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof ProjectServiceTimeout || error instanceof ProjectServiceUnreachable) return state.catalog;

    throw error;
  }
}
