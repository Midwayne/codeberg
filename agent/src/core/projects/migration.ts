import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readlink, rename, symlink, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { writeJsonAtomic } from '../learning/fs.js';
import { codebergHome } from '../paths.js';
import { lockMigration } from './lock.js';
import { type ProjectCatalog, projectDataHome } from './types.js';

/** Rename rather than copy durable queues and datasets. Interrupted upgrades
 * resume each missing source independently. Never overwrite a destination. */
export async function migrateProjectData(home: string, catalog: ProjectCatalog): Promise<void> {
  home = resolve(home);
  await mkdir(home, { recursive: true, mode: 0o700 });
  const unlock = await lockMigration(home);
  try {
    await migrateLocked(home, catalog);
  } finally {
    await unlock();
  }
}

export async function migrateLocked(home: string, catalog: ProjectCatalog): Promise<void> {
  const marker = join(home, 'projects-migrated.json');
  if (await migrationComplete(marker, catalog.legacyId)) return;

  const target = projectDataHome(home, catalog.legacyId);
  await mkdir(target, { recursive: true, mode: 0o700 });
  const names = [
    'web-sessions',
    'learning',
    'context',
    'spec.yml',
    'spec.yaml',
    'logs/agent.log',
    'logs/learning-agent.log',
    'logs/learning-agent-trace.log',
  ];

  // Validate all conflicts before moving the first file.
  for (const name of names) {
    const source = await info(join(home, name));
    if (!source || (await isContextAlias(home, target, name, source.isSymbolicLink()))) continue;

    if (await info(join(target, name))) throw new Error(`project migration conflict: ${name}`);
  }

  for (const name of names) {
    const source = await info(join(home, name));
    if (!source || (await isContextAlias(home, target, name, source.isSymbolicLink()))) continue;

    if (source.isSymbolicLink()) await makeLinkAbsolute(home, name);

    if (name.startsWith('logs/'))
      await mkdir(join(target, 'logs'), { recursive: true, mode: 0o700 });

    await rename(join(home, name), join(target, name));
  }

  // Old model transcripts contain absolute context paths. Preserve those reads
  // without keeping a second shared store or exposing it to other projects.
  if ((await info(join(target, 'context'))) && !(await info(join(home, 'context')))) {
    await symlink(join(target, 'context'), join(home, 'context'), 'dir');
  }

  await writeJsonAtomic(marker, { version: 1, projectId: catalog.legacyId });
}

export async function isContextAlias(home: string, target: string, name: string, isLink: boolean) {
  return (
    name === 'context' &&
    isLink &&
    resolve(home, await readlink(join(home, name))) === join(target, 'context')
  );
}

/** Upgrade CLI-only installations too; older daemons without a catalog retain
 * their existing stores until the daemon itself has been upgraded. */
export async function prepareProjectStorage(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const home = codebergHome(env);
  const raw = await readFile(join(home, 'projects.json'), 'utf8').catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;

      return undefined;
    },
  );

  if (raw) await migrateProjectData(home, JSON.parse(raw) as ProjectCatalog);
}

export async function info(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;

    return undefined;
  });
}

export { lockMigration } from './lock.js';

async function makeLinkAbsolute(home: string, name: string): Promise<void> {
  // A relative symlink would change meaning after moving deeper in the tree.
  const temporary = join(home, `.project-link-${randomUUID()}`);
  try {
    await symlink(
      resolve(dirname(join(home, name)), await readlink(join(home, name))),
      temporary,
      'dir',
    );
    await rename(temporary, join(home, name));
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function migrationComplete(marker: string, legacyId: string): Promise<boolean> {
  const migrated = await readFile(marker, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;

    return undefined;
  });

  if (migrated) {
    if (JSON.parse(migrated).projectId !== legacyId)
      throw new Error('project migration owner changed');

    return true;
  }

  return false;
}
