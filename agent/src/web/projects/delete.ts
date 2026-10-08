import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProjectCatalog } from '../../core/projects.js';
import { trackWrite } from '../server/write-gate.js';
import { readJson, requireJsonMutation, sendJson } from '../http.js';
import { daemon } from './routing.js';
import type { ProjectRequestRouterState } from './state.js';

export async function deleteProject(
  state: ProjectRequestRouterState,
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
): Promise<void> {
  if (!requireJsonMutation(req, res, 'DELETE', 'project changes')) return;

  const body = await readJson(req);
  if (body?.mode !== 'index' && body?.mode !== 'all')
    return sendJson(res, 400, { message: 'Choose deletion mode: index or all.' });

  state.catalog = await daemon(state, '/projects');
  if (!state.catalog.projects.some((project) => project.id === id))
    return sendJson(res, 404, { message: 'Project no longer exists. Refresh projects and try again.' });

  if (state.deleting.has(id) || state.active.has(id))
    return sendJson(res, 409, { message: 'Project is busy. Try again after active requests finish.' });

  state.deleting.add(id);
  try {
    await state.handlers.get(id);
    await state.options.dispose?.(id);
    state.handlers.delete(id);

    return await removeProject(state, res, id, body.mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return sendJson(res, message.startsWith('Project is busy.') ? 409 : 503, { message });
  } finally {
    state.deleting.delete(id);
  }
}

async function removeProject(
  state: ProjectRequestRouterState,
  res: ServerResponse,
  id: string,
  mode: string,
) {
  const response = await fetch(new URL(`/projects/${id}`, state.options.daemonUrl), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
    signal: AbortSignal.timeout(120000),
  });
  const result = await response.json();
  if (!response.ok) return sendJson(res, response.status, result);

  state.catalog = result as ProjectCatalog;

  return sendJson(res, 200, {
    ...state.catalog,
    catalogPath: join(state.home, 'projects.json'),
    projects: state.catalog.projects.map(state.projectInfo),
  });
}

/** Count storage requests through response completion, including streams. */
export function trackRequest(state: ProjectRequestRouterState, id: string, res: ServerResponse) {
  state.active.set(id, (state.active.get(id) ?? 0) + 1);
  return trackWrite(res, () => {
    const count = (state.active.get(id) ?? 1) - 1;
    if (count > 0) state.active.set(id, count);
    else state.active.delete(id);
  });
}
