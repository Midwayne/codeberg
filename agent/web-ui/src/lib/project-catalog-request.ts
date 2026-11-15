import type { ProjectCatalog } from './project-api';

/** Waits between attempts while the project service is still starting (about 10 seconds in all). */
const RETRY_DELAYS_MS = [500, 1000, 2000, 3000, 4000];

class ProjectCatalogError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** A dropped connection, an unreachable daemon (502) or a proxy timeout (504) usually clears by itself. */
function transient(error: unknown): boolean {
  return error instanceof TypeError ||
    (error instanceof ProjectCatalogError && [502, 504].includes(error.status));
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
  const response = await fetch('/api/projects', { signal });
  if (!response.ok) throw new ProjectCatalogError(await response.text(), response.status);

  return await response.json() as ProjectCatalog;
}

/**
 * Loads the project catalog, quietly retrying while the project service comes
 * up so a page opened during startup loads instead of showing an error.
 */
export async function requestProjectCatalog(signal: AbortSignal): Promise<ProjectCatalog> {
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
