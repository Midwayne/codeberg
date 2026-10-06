import { join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Project, ProjectCatalog } from '../core/projects.js';
import { withProjectLog } from '../core/module-log.js';
import { codebergHome } from '../core/paths.js';
import { projectDataHome } from '../core/projects.js';
import { readJson, requireJsonMutation, sameOrigin, sendJson, sendText } from './http.js';
import { openConfigDirectory } from './config-directory.js';

export interface ProjectRouterOptions {
  catalog: ProjectCatalog;
  home?: string;
  daemonUrl: string;
  build: (project: Project) => Promise<(req: IncomingMessage, res: ServerResponse) => void>;
  extensions?: (req: IncomingMessage, res: ServerResponse, project: Project) => Promise<void>;
  openConfigDirectory?: (path: string) => Promise<void>;
}

/** Requests and late writes retain their owning project's handler. */
export function createProjectRequestHandler(options: ProjectRouterOptions) {
  const router = new ProjectRequestRouter(options);

  return (req: IncomingMessage, res: ServerResponse) => router.handle(req, res);
}

class ProjectRequestRouter {
  private catalog: ProjectCatalog;
  private readonly home: string;
  private readonly handlers = new Map<string, ReturnType<ProjectRouterOptions['build']>>();

  constructor(private readonly options: ProjectRouterOptions) {
    this.catalog = options.catalog;
    this.home = resolve(options.home ?? codebergHome());
  }

  handle(req: IncomingMessage, res: ServerResponse): void {
    void this.route(req, res).catch((error: unknown) => {
      if (!res.headersSent)
        sendText(res, 503, error instanceof Error ? error.message : 'Project service unavailable');
      else res.end();
    });
  }

  private projectInfo = (project: Project) => ({
    ...project,
    configDirectory: projectDataHome(this.home, project.id),
  });

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('Cache-Control', 'no-store');

    switch (url.pathname) {
      case '/api/config/open-directory':
        return this.openConfig(req, res);
      case '/api/projects/pick-directory':
        return this.pickDirectory(req, res);
      case '/api/projects':
        return this.projects(req, res);
    }

    const projectRoute = /^\/api\/projects\/([^/]+)$/.exec(url.pathname);
    if (projectRoute) return this.renameProject(req, res, projectRoute[1]!);

    return this.dispatchProject(req, res, url);
  }

  private async daemon(path: string, init?: RequestInit) {
    const response = await fetch(new URL(path, this.options.daemonUrl), {
      ...init,
      signal: AbortSignal.timeout(5000),
    });

    const body = await response.json();
    if (!response.ok) throw new Error(body.message ?? 'Project service unavailable');

    return body;
  }

  private async openConfig(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!requireJsonMutation(req, res, 'POST', 'config actions')) return;

    const path = resolve(this.options.home ?? codebergHome());
    try {
      await (this.options.openConfigDirectory ?? openConfigDirectory)(path);

      return sendJson(res, 200, { path });
    } catch {
      return sendJson(res, 503, {
        path,
        message: 'Could not open the system file manager. Open this config directory manually.',
      });
    }
  }

  private async pickDirectory(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
      const response = await fetch(new URL('/projects/pick-directory', this.options.daemonUrl), {
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

  private async projects(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'GET') {
      this.catalog = await this.daemon('/projects');

      return sendJson(res, 200, {
        ...this.catalog,
        catalogPath: join(this.home, 'projects.json'),
        projects: this.catalog.projects.map(this.projectInfo),
      });
    }

    if (!requireJsonMutation(req, res, 'POST', 'project changes')) return;

    const project = await this.daemon('/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(await readJson(req)),
    });

    this.catalog = await this.daemon('/projects');

    return sendJson(res, 201, this.projectInfo(project));
  }

  private async renameProject(
    req: IncomingMessage,
    res: ServerResponse,
    id: string,
  ): Promise<void> {
    if (!requireJsonMutation(req, res, 'PATCH', 'project changes')) return;

    // Refresh the this.catalog so a project added by another tab is addressable.
    this.catalog = await this.daemon('/projects');
    if (!this.catalog.projects.some((project) => project.id === id))
      return sendText(res, 404, 'project not found');

    const body = await readJson(req);
    if (!body || typeof body !== 'object')
      return sendJson(res, 400, { message: 'invalid project name' });

    const response = await fetch(new URL(`/projects/${id}`, this.options.daemonUrl), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: body.name }),
      signal: AbortSignal.timeout(5000),
    });

    const result = await response.json();
    if (!response.ok) return sendJson(res, response.status, result);

    const project = result as Project;
    this.catalog = {
      ...this.catalog,
      projects: this.catalog.projects.map((existing) =>
        existing.id === project.id ? project : existing,
      ),
    };

    return sendJson(res, 200, this.projectInfo(project));
  }

  private async dispatchProject(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const id = req.headers['x-codeberg-project'];
    if (id !== undefined && typeof id !== 'string')
      return sendText(res, 400, 'invalid project selection');

    const project = this.catalog.projects.find(
      (project) => project.id === (id ?? this.catalog.defaultId),
    );
    if (!project) return sendText(res, 404, 'project not found');

    if (url.pathname === '/api/project/retry') {
      if (req.method !== 'POST') return sendText(res, 405, 'method not allowed');

      if (!sameOrigin(req))
        return sendText(res, 403, 'cross-origin project changes are not allowed');

      return sendJson(
        res,
        200,
        await this.daemon(`/projects/${project.id}/retry`, { method: 'POST' }),
      );
    }

    if (url.pathname === '/api/project/status') {
      if (req.method !== 'GET') return sendText(res, 405, 'method not allowed');

      return sendJson(res, 200, await this.daemon(`/projects/${project.id}/health`));
    }

    if (
      (url.pathname === '/api/extensions' || url.pathname === '/api/extensions/skills/preview') &&
      this.options.extensions
    ) {
      if (req.method !== 'GET' && !sameOrigin(req))
        return sendText(res, 403, 'cross-origin extension changes are not allowed');

      return this.options.extensions(req, res, project);
    }

    const selectedHandler = await this.projectHandler(project);
    withProjectLog(
      join(projectDataHome(this.options.home ?? codebergHome(), project.id), 'logs'),
      () => selectedHandler(req, res),
    );
  }
  private projectHandler(project: Project) {
    let handler = this.handlers.get(project.id);
    if (!handler) {
      handler = withProjectLog(
        join(projectDataHome(this.options.home ?? codebergHome(), project.id), 'logs'),
        () => this.options.build(project),
      ).catch((error) => {
        this.handlers.delete(project.id);
        throw error;
      });
      this.handlers.set(project.id, handler);
    }

    return handler;
  }
}
