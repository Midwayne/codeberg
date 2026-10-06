import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { codebergHome } from '../../core/paths.js';
import type { Project } from '../../core/projects.js';
import { openConfigDirectory } from '../config-directory.js';
import { readJson, requireJsonMutation, sameOrigin, sendJson, sendText } from '../http.js';
import { daemon } from './routing.js';
import type { ProjectRequestRouterState } from './state.js';

export async function openConfig(
  state: ProjectRequestRouterState,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!requireJsonMutation(req, res, 'POST', 'config actions')) return;

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
  if (req.method !== 'POST') return sendText(res, 405, 'method not allowed');

  if (!sameOrigin(req)) return sendText(res, 403, 'cross-origin folder selection is not allowed');

  if (!req.headers['content-type']?.startsWith('application/json'))
    return sendText(res, 415, 'application/json required');

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
      catalogPath: join(state.home, 'projects.json'),
      projects: state.catalog.projects.map(state.projectInfo),
    });
  }

  if (!requireJsonMutation(req, res, 'POST', 'project changes')) return;

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
  if (!requireJsonMutation(req, res, 'PATCH', 'project changes')) return;

  // Refresh the this.catalog so a project added by another tab is addressable.
  state.catalog = await daemon(state, '/projects');
  if (!state.catalog.projects.some((project) => project.id === id))
    return sendText(res, 404, 'project not found');

  const body = await readJson(req);
  if (!body || typeof body !== 'object')
    return sendJson(res, 400, { message: 'invalid project name' });

  const response = await fetch(new URL(`/projects/${id}`, state.options.daemonUrl), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: body.name }),
    signal: AbortSignal.timeout(5000),
  });

  const result = await response.json();
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
