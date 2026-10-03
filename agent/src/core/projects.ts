import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { lstat, mkdir, readFile, rename, symlink, readlink, open, unlink, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

import { codebergDataHome, codebergHome } from './paths.js';
import { writeJsonAtomic } from './learning/fs.js';

export interface Project {
  id: string;
  name: string;
  roots: { key: string; root: string }[];
  legacyIndex?: string;
}
export interface ProjectCatalog {
  version: 1;
  defaultId: string;
  legacyId: string;
  projects: Project[];
}

export function projectDataHome(home: string, id: string): string {
  if (!/^p-[a-f0-9]{16}$/.test(id)) throw new Error('invalid project ID');
  return join(home, 'projects', id);
}

/** Rename rather than copy durable queues and datasets. Interrupted upgrades
 * resume each missing source independently. Never overwrite a destination. */
export async function migrateProjectData(home: string, catalog: ProjectCatalog): Promise<void> {
  home = resolve(home);
  await mkdir(home, { recursive: true, mode: 0o700 });
  const unlock = await lockMigration(home);
  try { await migrateLocked(home, catalog); } finally { await unlock(); }
}

async function migrateLocked(home: string, catalog: ProjectCatalog): Promise<void> {
  const marker = join(home, 'projects-migrated.json');
  const migrated = await readFile(marker, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (migrated) {
    if (JSON.parse(migrated).projectId !== catalog.legacyId) throw new Error('project migration owner changed');
    return;
  }
  const target = projectDataHome(home, catalog.legacyId);
  await mkdir(target, { recursive: true, mode: 0o700 });
  const names = ['web-sessions', 'learning', 'context', 'spec.yml', 'spec.yaml', 'logs/agent.log', 'logs/learning-agent.log', 'logs/learning-agent-trace.log'];
  // Validate all conflicts before moving the first file.
  for (const name of names) {
    const source = await info(join(home, name));
    if (!source || await isContextAlias(home, target, name, source.isSymbolicLink())) continue;
    if (await info(join(target, name))) throw new Error(`project migration conflict: ${name}`);
  }
  for (const name of names) {
    const source = await info(join(home, name));
    if (!source || await isContextAlias(home, target, name, source.isSymbolicLink())) continue;
    if (source.isSymbolicLink()) {
      // A relative symlink would change meaning after moving deeper in the tree.
      const temporary = join(home, `.project-link-${randomUUID()}`);
      try {
        await symlink(resolve(dirname(join(home, name)), await readlink(join(home, name))), temporary, 'dir');
        await rename(temporary, join(home, name));
      } finally { await unlink(temporary).catch(() => undefined); }
    }
    if (name.startsWith('logs/')) await mkdir(join(target, 'logs'), { recursive: true, mode: 0o700 });
    await rename(join(home, name), join(target, name));
  }
  // Old model transcripts contain absolute context paths. Preserve those reads
  // without keeping a second shared store or exposing it to other projects.
  if (await info(join(target, 'context')) && !await info(join(home, 'context'))) {
    await symlink(join(target, 'context'), join(home, 'context'), 'dir');
  }
  await writeJsonAtomic(marker, { version: 1, projectId: catalog.legacyId });
}
async function isContextAlias(home: string, target: string, name: string, isLink: boolean) {
  return name === 'context' && isLink && resolve(home, await readlink(join(home, name))) === join(target, 'context');
}

// Shared by CLI and web processes, including interrupted upgrade recovery.
async function lockMigration(home: string): Promise<() => Promise<void>> {
  const path = join(home, '.project-migration.lock');
  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      const handle = await open(path, 'wx', 0o600);
      try { await handle.writeFile(String(process.pid)); } finally { await handle.close(); }
      return () => unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const owner = await readFile(path, 'utf8').catch(() => '');
      const pid = Number(owner);
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
            if (await readFile(path, 'utf8').catch(() => '') === owner) await unlink(path).catch(() => undefined);
            continue;
          }
        }
      } else {
        // A process may exit between creating the lock and writing its PID.
        const file = await stat(path).catch(() => undefined);
        if (file && Date.now() - file.mtimeMs > 10000) { await unlink(path).catch(() => undefined); continue; }
      }
      if (Date.now() > deadline) throw new Error('Another Codeberg process is migrating project data. Retry after it finishes.');
      await new Promise((done) => setTimeout(done, 25));
    }
  }
}

/** Upgrade CLI-only installations too; older daemons without a catalog retain
 * their existing stores until the daemon itself has been upgraded. */
export async function prepareProjectStorage(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const home = codebergHome(env);
  const raw = await readFile(join(home, 'projects.json'), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (raw) await migrateProjectData(home, JSON.parse(raw) as ProjectCatalog);
}

async function info(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
}

/** A private environment snapshot; selecting a project never edits process.env. */
export function projectEnvironment(env: NodeJS.ProcessEnv, project: Project, catalog: ProjectCatalog): NodeJS.ProcessEnv {
  const data = projectDataHome(codebergHome(env), project.id);
  const out: NodeJS.ProcessEnv = { ...env, CODEBERG_PROJECT_HOME: data, CODEBERG_PROJECT_ID: project.id,
    CODEBERG_ROOT: project.roots.map((root) => root.root).join(','),
    CODEBERG_LOG_DIR: join(data, 'logs'),
    CODEBERG_ROOTS: project.roots.map((root) => `${root.key}\t${root.root}`).join('\n'),
  };
  // Match daemon namespaces, including upgrade compatibility exceptions.
  const legacyIndex = project.legacyIndex;
  out.CBERG_INDEX_PATH = legacyIndex && ((env.CBERG_INDEX_BACKEND && env.CBERG_INDEX_BACKEND !== 'usearch') || !legacyIndex.startsWith(join(codebergHome(env), 'index') + sep))
    ? legacyIndex : join(data, 'index', 'codeberg.usearch');
  const legacySpec = project.id === catalog.legacyId ? env.CODEBERG_DBMCP_SPEC?.trim() : undefined;
  const expandedSpec = legacySpec === '~' ? homedir() : legacySpec?.startsWith('~/') ? join(homedir(), legacySpec.slice(2)) : legacySpec;
  const managedSpec = expandedSpec && ['spec.yml', 'spec.yaml'].find((name) => resolve(expandedSpec) === resolve(codebergHome(env), name));
  out.CODEBERG_DBMCP_SPEC = legacySpec && !managedSpec ? legacySpec
    : join(data, managedSpec || (existsSync(join(data, 'spec.yml')) || !existsSync(join(data, 'spec.yaml')) ? 'spec.yml' : 'spec.yaml'));
  // Discovery reads project storage in addition to the selected repository.
  return out;
}

/** Default CLI discovery follows the launched project after migration. */
export function currentProjectEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (env.CODEBERG_PROJECT_HOME) return env;
  const home = codebergHome(env);
  if (!existsSync(join(home, 'projects-migrated.json'))) return env;
  const catalog = JSON.parse(readFileSync(join(home, 'projects.json'), 'utf8')) as ProjectCatalog;
  const data = codebergDataHome(env);
  const project = catalog.projects.find((project) => projectDataHome(home, project.id) === data);
  if (!project) throw new Error('Project storage has no registered owner.');
  return projectEnvironment(env, project, catalog);
}
