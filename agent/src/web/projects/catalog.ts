import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { codebergHome } from '../../core/paths.js';
import { projectCatalogPath, type Project } from '../../core/projects/types.js';
import { openConfigDirectory } from '../config-directory.js';
import { readJson, requireJsonMethod, sendJson, sendText } from '../http.js';
import type { ProjectRequestRouterState } from './state.js';
import { daemon, requestProjectService } from './request.js';

export async function openConfig(
  state: ProjectRequestRouterState,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!requireJsonMethod(req, res, 'POST')) return;

  const path = resolve(state.options.home ?? codebergHome());
  try {
    await (state.options.openConfigDirectory ?? openConfigDirectory)(path);

    return sendJson(res, 200, { path });
  } catch {
    return sendJson(res, 503, {
      path,
      message: 'Could not open the system file manager. Open this config directory manually.',
    });
  }
}

export async function pickDirectory(
  state: ProjectRequestRouterState,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!requireJsonMethod(req, res, 'POST')) return;

  const body = await readJson(req);
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once('close', abort);
  try {
    // A person may spend minutes in the OS dialog. Closing the web dialog
    // aborts the helper too, so a stale tab cannot keep the picker occupied.
    const response = await fetch(new URL('/projects/pick-directory', state.options.daemonUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(310000)]),
    });

    return sendJson(res, response.status, await response.json());
  } finally {
    res.off('close', abort);
  }
}

export async function projects(
  state: ProjectRequestRouterState,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method === 'GET') {
    state.catalog = await daemon(state, '/projects');

    return sendJson(res, 200, {
      ...state.catalog,
      catalogPath: projectCatalogPath(state.home),
      projects: state.catalog.projects.map(state.projectInfo),
    });
  }

  if (!requireJsonMethod(req, res, 'POST')) return;

  const project = await daemon(state, '/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(await readJson(req)),
  });

  state.catalog = await daemon(state, '/projects');

  return sendJson(res, 201, state.projectInfo(project));
}

export async function renameProject(
  state: ProjectRequestRouterState,
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
): Promise<void> {
  if (!requireJsonMethod(req, res, 'PATCH')) return;

  // Refresh the catalog so a project added by another tab is addressable.
  state.catalog = await daemon(state, '/projects');
  if (!state.catalog.projects.some((project) => project.id === id))
    return sendText(res, 404, 'project not found');

  const body = await readJson(req);
  if (!body || typeof body !== 'object')
    return sendJson(res, 400, { message: 'invalid project name' });

  const { response, body: result } = await requestProjectService(state.options.daemonUrl, `/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: body.name }),
  });

  if (!response.ok) return sendJson(res, response.status, result);

  const project = result as Project;
  state.catalog = {
    ...state.catalog,
    projects: state.catalog.projects.map((existing) =>
      existing.id === project.id ? project : existing,
    ),
  };

  return sendJson(res, 200, state.projectInfo(project));
}
