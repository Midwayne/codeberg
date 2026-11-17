import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { projectDataHome } from '../../core/projects.js';
import { projectHandler } from './routing.js';
import type { ProjectRequestRouterState } from './state.js';
import { ifMissing } from '../../core/fs.js';

/** Wake persisted project queues on startup even if no browser opens the project. */
export async function restoreScheduledProjects(state: ProjectRequestRouterState): Promise<void> {
  await Promise.all(state.catalog.projects.map(async (project) => {
    const directory = join(projectDataHome(state.home, project.id), 'web-sessions');
    const found = await Promise.all(['.schedules/queue.json', '.jobs'].map((name) => access(join(directory, name)).then(() => true, ifMissing(false))));
    if (!found.some(Boolean)) return;

    await projectHandler(state, project).catch((error) => {
      console.error(`Scheduled project ${project.id} could not start:`, error);
    });
  }));
}
