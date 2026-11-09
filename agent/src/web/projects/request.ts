import { HttpError } from '../../core/api/errors.js';
import type { ProjectRequestRouterState } from './state.js';

/** A project with active background work cannot be disposed or deleted yet. */
export class ProjectBusyError extends HttpError {
  constructor() {
    super(409, 'Project is busy. Try again after background jobs finish.');
  }
}

export class ProjectServiceTimeout extends HttpError {
  constructor(method: string) {
    super(504, method === 'GET'
      ? 'Project service did not respond in time. Codeberg may be busy indexing. Try again shortly.'
      : 'Project operation did not respond in time and may still complete. Refresh projects before retrying.');
  }
}

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

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function daemon(state: ProjectRequestRouterState, path: string, init?: RequestInit) {
  const { response, body } = await requestProjectService(state.options.daemonUrl, path, init);
  if (!response.ok) throw new Error(body.message ?? 'Project service unavailable');

  return body;
}
