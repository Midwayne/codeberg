import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { projectDataHome } from '../../core/projects/types.js';
import { ProjectRequestRouter } from '../projects.js';

it('restores projects with durable schedules without browser traffic and reuses handlers', async () => {
  const home = await mkdtemp(join(tmpdir(), 'codeberg-schedule-startup-'));
  const project = { id: 'p-0123456789abcdef', name: 'Scheduled', roots: [{ key: 'repo', root: '/repo' }] };
  const other = { ...project, id: 'p-abcdef0123456789', name: 'Unopened' };
  const build = vi.fn(async () => (_req: unknown, _res: unknown) => undefined);
  try {
    const directory = join(projectDataHome(home, project.id), 'web-sessions', '.schedules');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'queue.json'), '[]');
    const router = new ProjectRequestRouter({ home, daemonUrl: 'http://unused', build,
      catalog: { version: 1, defaultId: project.id, legacyId: project.id, projects: [project, other] } });
    await router.restoreSchedules();
    await router.restoreSchedules();

    expect(build).toHaveBeenCalledExactlyOnceWith(project);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it('recovers background-only projects without waiting for a browser to open them', async () => {
  const home = await mkdtemp(join(tmpdir(), 'codeberg-background-startup-'));
  const project = { id: 'p-0123456789abcdef', name: 'Background', roots: [{ key: 'repo', root: '/repo' }] };
  const build = vi.fn(async () => (_req: unknown, _res: unknown) => undefined);
  try {
    await mkdir(join(projectDataHome(home, project.id), 'web-sessions', '.jobs'), { recursive: true });
    const router = new ProjectRequestRouter({ home, daemonUrl: 'http://unused', build,
      catalog: { version: 1, defaultId: project.id, legacyId: project.id, projects: [project] } });
    await router.restoreSchedules();
    expect(build).toHaveBeenCalledExactlyOnceWith(project);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
