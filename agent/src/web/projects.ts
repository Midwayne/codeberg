import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Project, ProjectCatalog } from '../core/projects/types.js';
import { handle } from './projects/routing.js';
import { ProjectRequestRouterState } from './projects/state.js';
import type { SetupStatus } from '../core/setup-types.js';
import type { ToolSettingsStore } from './tools/settings.js';
import { restoreScheduledProjects } from './projects/scheduled.js';

export class ProjectRequestRouter {
  private readonly state: ProjectRequestRouterState;

  constructor(options: ProjectRouterOptions) {
    this.state = new ProjectRequestRouterState(options);
  }

  handle(req: IncomingMessage, res: ServerResponse): void {
    return handle(this.state, req, res);
  }

  restoreSchedules(): Promise<void> {
    return restoreScheduledProjects(this.state);
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
  tools?: ToolSettingsStore;
  /** Reports whether chat can start; servers without a check are treated as ready. */
  setup?: () => Promise<SetupStatus>;
}

export function createProjectRequestHandler(options: ProjectRouterOptions) {
  const router = new ProjectRequestRouter(options);

  return (req: IncomingMessage, res: ServerResponse) => router.handle(req, res);
}
