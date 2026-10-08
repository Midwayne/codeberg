import { createContext, useContext } from 'react';

export interface Project {
  id: string;
  name: string;
  roots: { key: string; root: string }[];
  configDirectory?: string;
}
export interface ProjectCatalog {
  defaultId: string;
  projects: Project[];
  catalogPath?: string;
}
export interface ProjectStatus {
  ready: boolean;
  chunks: number;
  status?: string;
  message?: string;
}
const unscopedFetch: typeof fetch = (...args) => globalThis.fetch(...args);
export const ProjectApiContext = createContext<{
  project?: Project;
  fetch: typeof fetch;
  ready: boolean;
  onProjectDeleted?: (catalog: ProjectCatalog) => void;
  onProjectRenamed?: (project: Project) => void;
}>({ fetch: unscopedFetch, ready: true });
export function useProjectApi() {
  return useContext(ProjectApiContext);
}

export function projectFetch(id: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set('X-Codeberg-Project', id);
    return globalThis.fetch(input, { ...init, headers });
  };
}
