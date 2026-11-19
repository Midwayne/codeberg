import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Project } from '../../core/projects.js';
import { readJson, requireJsonMutation, sendJson } from '../http.js';
import { daemon, requestProjectService, serviceError } from './request.js';
import type { ProjectRequestRouterState } from './state.js';

/** Lists the repositories a directory would be split into, without adding it. */
export async function discoverRepositories(
  state: ProjectRequestRouterState,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  if (req.method !== 'GET') return sendJson(res, 405, { message: 'method not allowed' });

  const root = url.searchParams.get('root') ?? '';

  return sendJson(res, 200, await daemon(state, `/projects/discover?root=${encodeURIComponent(root)}`));
}

/**
 * Finds a project's repositories again. Changed roots dispose the project's
 * handler so the next request builds one over them; running requests would be
 * cut off, so a busy project is refused as for deletion.
 */
export async function rescanProject(
  state: ProjectRequestRouterState,
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
): Promise<void> {
  if (!requireJsonMutation(req, res, 'POST', 'project changes')) return;

  if (state.deleting.has(id) || state.active.has(id))
    return sendJson(res, 409, { message: 'Project is busy. Try again after active requests finish.' });

  const before = state.catalog.projects.find((project) => project.id === id);
  const { response, body } = await requestProjectService(state.options.daemonUrl, `/projects/${id}/rescan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify((await readJson(req)) ?? {}),
  });

  if (!response.ok) throw serviceError(response, body);

  const project = body as Project;
  if (JSON.stringify(before?.roots) !== JSON.stringify(project.roots)) await dropHandler(state, id);

  state.catalog = await daemon(state, '/projects');

  return sendJson(res, 200, state.projectInfo(project));
}

async function dropHandler(state: ProjectRequestRouterState, id: string): Promise<void> {
  if (!state.handlers.has(id)) return;

  await state.handlers.get(id)?.catch(() => undefined);
  await state.options.dispose?.(id);
  state.handlers.delete(id);
}
