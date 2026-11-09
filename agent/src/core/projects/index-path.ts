import { basename, dirname, join, sep } from 'node:path';
import { codebergHome } from '../paths.js';

/** Same base name the daemon passes to the indexer (`storage.IndexFile`). */
export const INDEX_FILE = 'codeberg.usearch';

/** Match daemon `RemoteIndex`: non-empty backend other than local usearch. */
export function remoteIndex(env: NodeJS.ProcessEnv): boolean {
  const backend = env.CBERG_INDEX_BACKEND ?? '';

  return backend !== '' && backend !== 'usearch';
}

/** Match daemon `Layout.InLegacyIndexDir`. */
export function inLegacyIndexDir(home: string, path: string): boolean {
  return path.startsWith(join(home, 'index') + sep);
}

/** Match daemon `customIndex` for external legacy paths + embedding namespace. */
export function customIndex(path: string, namespace: string): string {
  if (!namespace) return path;

  return join(dirname(path), namespace, basename(path));
}

/** Match daemon `Layout.ProjectIndex`. */
export function projectIndex(projectData: string, namespace: string): string {
  return namespace
    ? join(projectData, 'index', namespace, INDEX_FILE)
    : join(projectData, 'index', INDEX_FILE);
}

/**
 * Same upgrade rules as daemon `Manager.indexPath`: remote keeps legacy path,
 * external custom stays (namespaced when set), managed legacy migrates.
 */
export function projectIndexPath(
  env: NodeJS.ProcessEnv,
  projectData: string,
  legacyIndex: string | undefined,
): string {
  const namespace = env.CODEBERG_INDEX_NAMESPACE ?? '';
  const home = codebergHome(env);

  if (legacyIndex && remoteIndex(env)) return legacyIndex;

  if (legacyIndex && !inLegacyIndexDir(home, legacyIndex)) {
    return customIndex(legacyIndex, namespace);
  }

  return projectIndex(projectData, namespace);
}
