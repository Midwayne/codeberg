import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { type Project, type ProjectCatalog, projectDataHome } from './projects/types.js';

import { codebergDataHome, codebergHome } from './paths.js';

/** A private environment snapshot; selecting a project never edits process.env. */
export function projectEnvironment(
  env: NodeJS.ProcessEnv,
  project: Project,
  catalog: ProjectCatalog,
): NodeJS.ProcessEnv {
  const data = projectDataHome(codebergHome(env), project.id);
  const out: NodeJS.ProcessEnv = {
    ...env,
    CODEBERG_PROJECT_HOME: data,
    CODEBERG_PROJECT_ID: project.id,
    CODEBERG_ROOT: project.roots.map((root) => root.root).join(','),
    CODEBERG_LOG_DIR: join(data, 'logs'),
    CODEBERG_ROOTS: project.roots.map((root) => `${root.key}\t${root.root}`).join('\n'),
  };

  // Match daemon namespaces, including upgrade compatibility exceptions.
  const legacyIndex = project.legacyIndex;
  out.CBERG_INDEX_PATH =
    legacyIndex &&
    ((env.CBERG_INDEX_BACKEND && env.CBERG_INDEX_BACKEND !== 'usearch') ||
      !legacyIndex.startsWith(join(codebergHome(env), 'index') + sep))
      ? legacyIndex
      : join(data, 'index', 'codeberg.usearch');
  out.CODEBERG_DBMCP_SPEC = databaseSpec(env, project, catalog, data);

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

export type { Project, ProjectCatalog } from './projects/types.js';

export { projectDataHome } from './projects/types.js';

export { migrateProjectData, prepareProjectStorage } from './projects/migration.js';

function databaseSpec(
  env: NodeJS.ProcessEnv,
  project: Project,
  catalog: ProjectCatalog,
  data: string,
): string {
  const legacySpec = project.id === catalog.legacyId ? env.CODEBERG_DBMCP_SPEC?.trim() : undefined;
  const expandedSpec =
    legacySpec === '~'
      ? homedir()
      : legacySpec?.startsWith('~/')
        ? join(homedir(), legacySpec.slice(2))
        : legacySpec;

  const managedSpec =
    expandedSpec &&
    ['spec.yml', 'spec.yaml'].find(
      (name) => resolve(expandedSpec) === resolve(codebergHome(env), name),
    );

  return legacySpec && !managedSpec
    ? legacySpec
    : join(
        data,
        managedSpec ||
          (existsSync(join(data, 'spec.yml')) || !existsSync(join(data, 'spec.yaml'))
            ? 'spec.yml'
            : 'spec.yaml'),
      );
}
