import { join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Project, ProjectCatalog } from '../core/projects.js';
import { withProjectLog } from '../core/module-log.js';
import { codebergHome } from '../core/paths.js';
import { projectDataHome } from '../core/projects.js';
import { readJson, sendJson, sendText } from './http.js';
import { openConfigDirectory } from './config-directory.js';

export interface ProjectRouterOptions {
  catalog: ProjectCatalog;
  home?: string;
  daemonUrl: string;
  build: (project: Project) => Promise<(req: IncomingMessage, res: ServerResponse) => void>;
  extensions?: (req: IncomingMessage, res: ServerResponse, project: Project) => Promise<void>;
  openConfigDirectory?: (path: string) => Promise<void>;
}

/** Requests and their late writes retain the handler for their owning project.
 * No mutable active project, cookie, or process environment is involved. */
export function createProjectRequestHandler(options: ProjectRouterOptions) {
  let catalog = options.catalog;
  const handlers = new Map<string, ReturnType<ProjectRouterOptions['build']>>();
  async function daemon(path: string, init?: RequestInit) {
    const response = await fetch(new URL(path, options.daemonUrl), { ...init, signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message ?? 'Project service unavailable');
    return body;
  }
  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/api/config/open-directory') {
      if (req.method !== 'POST') return sendText(res, 405, 'method not allowed');
      if (!sameOrigin(req)) return sendText(res, 403, 'cross-origin config actions are not allowed');
      if (!req.headers['content-type']?.startsWith('application/json')) return sendText(res, 415, 'application/json required');
      const path = resolve(options.home ?? codebergHome());
      try {
        await (options.openConfigDirectory ?? openConfigDirectory)(path);
        return sendJson(res, 200, { path });
      } catch {
        return sendJson(res, 503, { path, message: 'Could not open the system file manager. Open this config directory manually.' });
      }
    }
    if (url.pathname === '/api/projects/pick-directory') {
      if (req.method !== 'POST') return sendText(res, 405, 'method not allowed');
      if (!sameOrigin(req)) return sendText(res, 403, 'cross-origin folder selection is not allowed');
      if (!req.headers['content-type']?.startsWith('application/json')) return sendText(res, 415, 'application/json required');
      const body = await readJson(req);
      const controller = new AbortController();
      const abort = () => controller.abort();
      res.once('close', abort);
      try {
        // A person may spend minutes in the OS dialog. Closing the web dialog
        // aborts the helper too, so a stale tab cannot keep the picker occupied.
        const response = await fetch(new URL('/projects/pick-directory', options.daemonUrl), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(310000)]),
        });
        return sendJson(res, response.status, await response.json());
      } finally { res.off('close', abort); }
    }
    if (url.pathname === '/api/projects') {
      if (req.method === 'GET') {
        catalog = await daemon('/projects');
        return sendJson(res, 200, catalog);
      }
      if (req.method !== 'POST') return sendText(res, 405, 'method not allowed');
      if (!sameOrigin(req)) return sendText(res, 403, 'cross-origin project changes are not allowed');
      if (!req.headers['content-type']?.startsWith('application/json')) return sendText(res, 415, 'application/json required');
      const project = await daemon('/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await readJson(req)) });
      catalog = await daemon('/projects');
      return sendJson(res, 201, project);
    }
    const id = req.headers['x-codeberg-project'];
    if (id !== undefined && typeof id !== 'string') return sendText(res, 400, 'invalid project selection');
    const project = catalog.projects.find((project) => project.id === (id ?? catalog.defaultId));
    if (!project) return sendText(res, 404, 'project not found');
    if (url.pathname === '/api/project/retry') {
      if (req.method !== 'POST') return sendText(res, 405, 'method not allowed');
      if (!sameOrigin(req)) return sendText(res, 403, 'cross-origin project changes are not allowed');
      return sendJson(res, 200, await daemon(`/projects/${project.id}/retry`, { method: 'POST' }));
    }
    if (url.pathname === '/api/project/status') {
      if (req.method !== 'GET') return sendText(res, 405, 'method not allowed');
      return sendJson(res, 200, await daemon(`/projects/${project.id}/health`));
    }
    if ((url.pathname === '/api/extensions' || url.pathname === '/api/extensions/skills/preview') && options.extensions) {
      if (req.method !== 'GET' && !sameOrigin(req)) return sendText(res, 403, 'cross-origin extension changes are not allowed');
      return options.extensions(req, res, project);
    }
    let handler = handlers.get(project.id);
    if (!handler) {
      handler = withProjectLog(join(projectDataHome(options.home ?? codebergHome(), project.id), 'logs'), () => options.build(project)).catch((error) => { handlers.delete(project.id); throw error; });
      handlers.set(project.id, handler);
    }
    const selectedHandler = await handler;
    withProjectLog(join(projectDataHome(options.home ?? codebergHome(), project.id), 'logs'), () => selectedHandler(req, res));
  }
  return (req: IncomingMessage, res: ServerResponse) => {
    void route(req, res).catch((error: unknown) => {
      if (!res.headersSent) sendText(res, 503, error instanceof Error ? error.message : 'Project service unavailable');
      else res.end();
    });
  };
}
function sameOrigin(req: IncomingMessage): boolean {
  return !req.headers.origin || req.headers.origin === `http://${req.headers.host}` || req.headers.origin === `https://${req.headers.host}`;
}
