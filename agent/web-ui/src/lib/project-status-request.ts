import type { ProjectStatus } from './project-api';
import { HttpError, readJson } from './http';

export async function requestProjectStatus(api: typeof fetch, parent: AbortSignal): Promise<ProjectStatus> {
  const controller = new AbortController();
  // The proxy has a 15-second deadline; leave time to receive its response.
  const timer = setTimeout(() => controller.abort(new DOMException('Project status request timed out', 'TimeoutError')), 20_000);

  try {
    const response = await api('/api/project/status', {
      signal: AbortSignal.any([parent, controller.signal]),
    });

    return await readJson<ProjectStatus>(response);
  } finally {
    clearTimeout(timer);
  }
}

export function transientStatusError(error: unknown): boolean {
  return error instanceof TypeError ||
    (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) ||
    (error instanceof HttpError && [408, 429, 502, 504].includes(error.status));
}

export function missingProject(error: unknown): boolean {
  return error instanceof HttpError && error.status === 404;
}
