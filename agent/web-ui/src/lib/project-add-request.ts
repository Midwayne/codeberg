import { HttpError, jsonInit, readJson } from './http';
import type { Project } from './project-api';

export type AddProjectResult =
  | { kind: 'added'; project: Project }
  | { kind: 'existing'; project: Project };

/** Adds a project; a directory that already has one returns that project instead. */
export async function requestAddProject(name: string, root: string, ignored: string[] = []): Promise<AddProjectResult> {
  const response = await fetch('/api/projects', jsonInit('POST', { name, root, ignored }));

  if (response.status === 409) {
    const body = await response.json() as { message?: string; project?: Project };

    if (body.project) return { kind: 'existing', project: body.project };

    throw new HttpError(body.message ?? 'This directory already has a project', 409);
  }

  return { kind: 'added', project: await readJson<Project>(response) };
}
