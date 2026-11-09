import { join } from 'node:path';

export interface Project {
  id: string;
  name: string;
  roots: { key: string; root: string }[];
  legacyIndex?: string;
}

export interface ProjectCatalog {
  vectorsEnabled?: boolean;
  version: 1;
  defaultId: string;
  legacyId: string;
  projects: Project[];
}

const PROJECT_ID = /^p-[a-f0-9]{16}$/;

export function isProjectId(id: string): boolean {
  return PROJECT_ID.test(id);
}

export const PROJECT_CATALOG_FILE = 'projects.json';

export const PROJECT_MIGRATION_FILE = 'projects-migrated.json';

export function projectCatalogPath(home: string): string {
  return join(home, PROJECT_CATALOG_FILE);
}

export function projectMigrationPath(home: string): string {
  return join(home, PROJECT_MIGRATION_FILE);
}

export function projectDataHome(home: string, id: string): string {
  if (!isProjectId(id)) throw new Error('invalid project ID');

  return join(home, 'projects', id);
}
