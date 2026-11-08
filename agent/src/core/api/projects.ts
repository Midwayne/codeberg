import type { Project, ProjectCatalog } from '../projects/types.js';

/** A catalog entry as `/api/projects*` returns it, with its storage directory. */
export type ProjectInfo = Pick<Project, 'id' | 'name' | 'roots'> & { configDirectory?: string };

/** `GET /api/projects` and the catalog returned after a deletion. */
export type ProjectCatalogInfo = Pick<ProjectCatalog, 'defaultId' | 'vectorsEnabled'> & {
  projects: ProjectInfo[];
  catalogPath?: string;
};

/** Selects the project for `/api/*` requests; canvas EventSource streams use `?project=`. */
export const PROJECT_HEADER = 'x-codeberg-project';
