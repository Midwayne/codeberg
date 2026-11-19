import { jsonInit, readJson } from './http';
import type { Project } from './project-api';

/** A folder inside a project directory that is indexed as its own root. */
export type DiscoveredRepository = { key: string; root: string; path: string; marker: string };

export type RepositoryPreview = { directory: string; repositories: DiscoveredRepository[] };

/** Lists the repositories Codeberg would find in a directory, without adding it. */
export async function previewRepositories(root: string, signal?: AbortSignal): Promise<RepositoryPreview> {
  const response = await fetch(`/api/projects/discover?root=${encodeURIComponent(root)}`, { signal });

  return readJson<RepositoryPreview>(response);
}

/** Finds a project's repositories again, keeping `ignored` folders in its directory. */
export async function rescanRepositories(id: string, ignored?: string[]): Promise<Project> {
  const response = await fetch(`/api/projects/${encodeURIComponent(id)}/rescan`, jsonInit('POST', { ignored }));

  return readJson<Project>(response);
}
