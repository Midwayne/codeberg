import { join } from 'node:path';
import { codebergHome } from '../core/paths.js';
import { currentProjectEnvironment } from '../core/projects.js';
import { prepareProjectStorage } from '../core/projects/migration.js';

/** Startup shared by the CLI entry points: upgrade project storage, then
 *  resolve the active project's environment (roots, storage, log dir). */
export async function cliProjectEnvironment(): Promise<NodeJS.ProcessEnv> {
  await prepareProjectStorage();

  process.env.CODEBERG_LOG_DIR ??= join(codebergHome(), 'logs');

  return currentProjectEnvironment();
}
