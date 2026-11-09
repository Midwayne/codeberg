import type { IncomingMessage, ServerResponse } from 'node:http';
import { projectCatalogPath, type ProjectCatalog } from '../../core/projects/types.js';
import { trackWrite } from '../server/write-gate.js';
import { readJson, requireJsonMethod, sendCaughtError, sendJson } from '../http.js';
import type { ProjectRequestRouterState } from './state.js';
import { daemon, requestProjectService } from './request.js';

export async function deleteProject(
  state: ProjectRequestRouterState,
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
): Promise<void> {
  if (!requireJsonMethod(req, res, 'DELETE')) return;

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
    return sendCaughtError(res, error, String(error), 'message');
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
  const { response, body: result } = await requestProjectService(state.options.daemonUrl, `/projects/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  }, 120_000);
  if (!response.ok) return sendJson(res, response.status, result);

  state.catalog = result as ProjectCatalog;

  return sendJson(res, 200, {
    ...state.catalog,
    catalogPath: projectCatalogPath(state.home),
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
