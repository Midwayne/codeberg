import type { ProjectStatus } from './project-api';

class ProjectStatusError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function requestProjectStatus(api: typeof fetch, parent: AbortSignal): Promise<ProjectStatus> {
  const controller = new AbortController();
  // The proxy has a 15-second deadline; leave time to receive its response.
  const timer = setTimeout(() => controller.abort(new DOMException('Project status request timed out', 'TimeoutError')), 20_000);

  try {
    const response = await api('/api/project/status', {
      signal: AbortSignal.any([parent, controller.signal]),
    });
    if (!response.ok) throw new ProjectStatusError(await response.text(), response.status);

    return await response.json() as ProjectStatus;
  } finally {
    clearTimeout(timer);
  }
}

export function transientStatusError(error: unknown): boolean {
  return error instanceof TypeError ||
    (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) ||
    (error instanceof ProjectStatusError && [408, 429, 502, 504].includes(error.status));
}

export function missingProject(error: unknown): boolean {
  return error instanceof ProjectStatusError && error.status === 404;
}
