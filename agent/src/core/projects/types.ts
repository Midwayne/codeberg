import { join } from 'node:path';

export interface Project {
  id: string;
  name: string;
  roots: { key: string; root: string }[];
  legacyIndex?: string;
}

export interface ProjectCatalog {
  version: 1;
  defaultId: string;
  legacyId: string;
  projects: Project[];
}

export function projectDataHome(home: string, id: string): string {
  if (!/^p-[a-f0-9]{16}$/.test(id)) throw new Error('invalid project ID');

  return join(home, 'projects', id);
}
