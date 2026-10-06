import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { withProjectLog } from '../../core/module-log.js';
import { codebergHome } from '../../core/paths.js';
import type { Project } from '../../core/projects.js';
import { projectDataHome } from '../../core/projects.js';
import { sameOrigin, sendJson, sendText } from '../http.js';
import { openConfig, pickDirectory, projects, renameProject } from './catalog.js';
import type { ProjectRequestRouterState } from './state.js';

export function handle(
  state: ProjectRequestRouterState,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  void route(state, req, res).catch((error: unknown) => {
    if (!res.headersSent)
      sendText(res, 503, error instanceof Error ? error.message : 'Project service unavailable');
    else res.end();
  });
}

export async function route(
  state: ProjectRequestRouterState,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  res.setHeader('Cache-Control', 'no-store');

  switch (url.pathname) {
    case '/api/config/open-directory':
      return openConfig(state, req, res);
    case '/api/projects/pick-directory':
      return pickDirectory(state, req, res);
    case '/api/projects':
      return projects(state, req, res);
  }

  const projectRoute = /^\/api\/projects\/([^/]+)$/.exec(url.pathname);
  if (projectRoute) return renameProject(state, req, res, projectRoute[1]!);

  return dispatchProject(state, req, res, url);
}

export async function daemon(state: ProjectRequestRouterState, path: string, init?: RequestInit) {
  const response = await fetch(new URL(path, state.options.daemonUrl), {
    ...init,
    signal: AbortSignal.timeout(5000),
  });

  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? 'Project service unavailable');

  return body;
}

export async function dispatchProject(
  state: ProjectRequestRouterState,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const id = req.headers['x-codeberg-project'];
  if (id !== undefined && typeof id !== 'string')
    return sendText(res, 400, 'invalid project selection');

  const project = state.catalog.projects.find(
    (project) => project.id === (id ?? state.catalog.defaultId),
  );
  if (!project) return sendText(res, 404, 'project not found');

  if (url.pathname === '/api/project/retry') {
    if (req.method !== 'POST') return sendText(res, 405, 'method not allowed');

    if (!sameOrigin(req)) return sendText(res, 403, 'cross-origin project changes are not allowed');

    return sendJson(
      res,
      200,
      await daemon(state, `/projects/${project.id}/retry`, { method: 'POST' }),
    );
  }

  if (url.pathname === '/api/project/status') {
    if (req.method !== 'GET') return sendText(res, 405, 'method not allowed');

    return sendJson(res, 200, await daemon(state, `/projects/${project.id}/health`));
  }

  if (
    (url.pathname === '/api/extensions' || url.pathname === '/api/extensions/skills/preview') &&
    state.options.extensions
  ) {
    if (req.method !== 'GET' && !sameOrigin(req))
      return sendText(res, 403, 'cross-origin extension changes are not allowed');

    return state.options.extensions(req, res, project);
  }

  const selectedHandler = await projectHandler(state, project);
  withProjectLog(
    join(projectDataHome(state.options.home ?? codebergHome(), project.id), 'logs'),
    () => selectedHandler(req, res),
  );
}

export function projectHandler(state: ProjectRequestRouterState, project: Project) {
  let handler = state.handlers.get(project.id);
  if (!handler) {
    handler = withProjectLog(
      join(projectDataHome(state.options.home ?? codebergHome(), project.id), 'logs'),
      () => state.options.build(project),
    ).catch((error) => {
      state.handlers.delete(project.id);
      throw error;
    });
    state.handlers.set(project.id, handler);
  }

  return handler;
}
