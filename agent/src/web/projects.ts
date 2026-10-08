import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Project, ProjectCatalog } from '../core/projects.js';
import { handle } from './projects/routing.js';
import { ProjectRequestRouterState } from './projects/state.js';

export class ProjectRequestRouter {
  private readonly state: ProjectRequestRouterState;

  constructor(options: ProjectRouterOptions) {
    this.state = new ProjectRequestRouterState(options);
  }

  handle(req: IncomingMessage, res: ServerResponse): void {
    return handle(this.state, req, res);
  }
}

export interface ProjectRouterOptions {
  catalog: ProjectCatalog;
  home?: string;
  staticRoot?: string;
  title?: string;
  daemonUrl: string;
  dispose?: (id: string) => Promise<void>;
  build: (project: Project) => Promise<(req: IncomingMessage, res: ServerResponse) => void>;
  extensions?: (req: IncomingMessage, res: ServerResponse, project: Project) => Promise<void>;
  openConfigDirectory?: (path: string) => Promise<void>;
}

export function createProjectRequestHandler(options: ProjectRouterOptions) {
  const router = new ProjectRequestRouter(options);

  return (req: IncomingMessage, res: ServerResponse) => router.handle(req, res);
}
