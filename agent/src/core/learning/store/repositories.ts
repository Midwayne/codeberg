import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { projectRoots } from '../../paths.js';
import type { RepositoryVersion } from '../types.js';

export const execFileAsync = promisify(execFile);

export async function repositoryVersions(
  roots = projectRoots(process.env, process.cwd()),
): Promise<RepositoryVersion[]> {
  return Promise.all(
    roots.map(async (path) => {
      const [branch, commit] = await Promise.all([
        git(path, ['rev-parse', '--abbrev-ref', 'HEAD']),
        git(path, ['rev-parse', 'HEAD']),
      ]);

      return { path, ...(branch ? { branch } : {}), ...(commit ? { commit } : {}) };
    }),
  );
}

export async function git(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });

    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}
