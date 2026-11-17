import type { ProjectCatalog } from './project-api';
import { HttpError, readJson } from './http';

/** Waits between attempts while the project service is still starting (about 10 seconds in all). */
const RETRY_DELAYS_MS = [500, 1000, 2000, 3000, 4000];

/** A dropped connection, an unreachable daemon (502) or a proxy timeout (504) usually clears by itself. */
function transient(error: unknown): boolean {
  return error instanceof TypeError ||
    (error instanceof HttpError && [502, 504].includes(error.status));
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);

    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

async function fetchCatalog(signal: AbortSignal): Promise<ProjectCatalog> {
  return readJson<ProjectCatalog>(await fetch('/api/projects', { signal }));
}

/**
 * Loads the project catalog, quietly retrying while the project service comes
 * up so a page opened during startup loads instead of showing an error.
 */
export async function requestProjectCatalog(
  signal: AbortSignal = new AbortController().signal,
): Promise<ProjectCatalog> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchCatalog(signal);
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (signal.aborted || delay === undefined || !transient(error)) throw error;

      await wait(delay, signal);
    }
  }
}
