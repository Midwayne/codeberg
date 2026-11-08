import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isProjectId, projectCatalogPath, projectDataHome, projectMigrationPath } from './projects/types.js';

/** Mirrors the launcher's Go `paths.Home`: a non-blank CODEBERG_HOME, else ~/.codeberg. */
export function codebergHome(env: NodeJS.ProcessEnv = process.env, userHome = homedir()): string {
  const home = env.CODEBERG_HOME?.trim();

  return home ? home : join(userHome, '.codeberg');
}

/** The CODEBERG_ROOTS wire format: key, tab, path, one record per line. */
export function formatIndexedRoots(roots: readonly { key: string; root: string }[]): string {
  return roots.map((root) => `${root.key}\t${root.root}`).join('\n');
}

/** Indexed repositories passed internally by the launcher or project catalog. */
export function indexedRootsFromEnv(env: NodeJS.ProcessEnv): string[] {
  const roots = env.CODEBERG_ROOTS;
  if (roots != null && roots.trim() !== '') {
    const out: string[] = [];
    for (const line of roots.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const tab = trimmed.indexOf('\t');
      out.push(tab >= 0 ? trimmed.slice(tab + 1).trim() : trimmed);
    }

    return out.filter(Boolean);
  }

  return [];
}

/** Nearest ancestor of `cwd` that contains `.git`, or `cwd` itself. */
export function findGitRoot(cwd: string, exists: (path: string) => boolean = existsSync): string {
  let dir = resolve(cwd);
  for (;;) {
    if (exists(join(dir, '.git'))) return dir;

    const parent = dirname(dir);
    if (parent === dir) return resolve(cwd);

    dir = parent;
  }
}

/**
 * Repositories this process should treat as the project: indexed roots from
 * the environment, or the git checkout of `cwd` when none are set.
 */
export function projectRoots(
  env: NodeJS.ProcessEnv,
  cwd: string,
  exists: (path: string) => boolean = existsSync,
): string[] {
  const indexed = indexedRootsFromEnv(env);
  if (indexed.length > 0) return indexed;

  return [findGitRoot(cwd, exists)];
}

/** Project-owned data. Global credentials/models continue to use codebergHome.
 * CLI callers match their configured roots; an explicit snapshot always wins. */
export function codebergDataHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CODEBERG_PROJECT_HOME) return env.CODEBERG_PROJECT_HOME;

  const home = codebergHome(env);
  try {
    if (!existsSync(projectCatalogPath(home))) return home;

    const catalog = JSON.parse(readFileSync(projectCatalogPath(home), 'utf8')) as {
      defaultId: string;
      legacyId: string;
      projects: { id: string; roots: { root: string }[] }[];
    };

    if (catalog.legacyId && !existsSync(projectMigrationPath(home))) return home;

    const configuredRoots = indexedRootsFromEnv(env);
    // The daemon skips missing keyed roots before registering its workspace.
    // Keep an explicit but unavailable selection from falling back to the default.
    const roots = configuredRoots
      .map(canonicalPath)
      .filter((root) => !env.CODEBERG_ROOTS?.trim() || existsSync(root));
    const project = configuredRoots.length
      ? catalog.projects.find(
          (candidate) =>
            roots.length > 0 &&
            candidate.roots.length === roots.length &&
            candidate.roots.every((root, i) => canonicalPath(root.root) === roots[i]),
        )
      : catalog.projects.find((candidate) => candidate.id === catalog.defaultId);

    if (project && isProjectId(project.id)) return projectDataHome(home, project.id);

    // Once upgraded, an unmatched root cannot write to the old shared store.
    throw new Error('Repository is not registered as a Codeberg project. Add it in the UI first.');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Repository is not')) throw error;

    throw new Error(`Unable to resolve project storage: ${String(error)}`);
  }
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
