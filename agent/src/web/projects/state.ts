import { resolve } from 'node:path';
import { codebergHome } from '../../core/paths.js';
import type { Project, ProjectCatalog } from '../../core/projects.js';
import { projectDataHome } from '../../core/projects.js';
import type { ProjectRouterOptions } from '../projects.js';

export class ProjectRequestRouterState {
  catalog: ProjectCatalog;

  readonly home: string;

  readonly handlers = new Map<string, ReturnType<ProjectRouterOptions['build']>>();

  readonly deleting = new Set<string>();

  readonly active = new Map<string, number>();

  constructor(readonly options: ProjectRouterOptions) {
    this.catalog = options.catalog;
    this.home = resolve(options.home ?? codebergHome());
  }

  projectInfo = (project: Project) => ({
    ...project,
    configDirectory: projectDataHome(this.home, project.id),
  });
}
