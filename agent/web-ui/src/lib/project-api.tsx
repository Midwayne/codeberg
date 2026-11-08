import { createContext, useContext } from 'react';

import { PROJECT_HEADER, type ProjectCatalogInfo, type ProjectInfo } from '@agent/core/api/projects.js';

const unscopedFetch: typeof fetch = (...args) => globalThis.fetch(...args);
export const ProjectApiContext = createContext<{
  project?: ProjectInfo;
  fetch: typeof fetch;
  ready: boolean;
  onProjectDeleted?: (catalog: ProjectCatalogInfo) => void;
  onProjectRenamed?: (project: ProjectInfo) => void;
}>({ fetch: unscopedFetch, ready: true });
export function useProjectApi() {
  return useContext(ProjectApiContext);
}

export function projectFetch(id: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set(PROJECT_HEADER, id);
    return globalThis.fetch(input, { ...init, headers });
  };
}
