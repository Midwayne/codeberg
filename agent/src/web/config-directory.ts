import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export function configDirectoryCommand(
  path: string,
  platform: string = process.platform,
): { command: string; args: string[]; env?: NodeJS.ProcessEnv } {
  switch (platform) {
    case 'darwin':
      return { command: '/usr/bin/open', args: [path] };
    case 'linux':
      return { command: 'xdg-open', args: [path] };
    case 'win32':
      return {
        command: 'powershell.exe',
        args: ['-NoProfile', '-Command', 'Invoke-Item -LiteralPath $env:CODEBERG_CONFIG_DIRECTORY'],
        env: { ...process.env, CODEBERG_CONFIG_DIRECTORY: path },
      };
    default:
      throw new Error('A system file manager is unavailable on this platform.');
  }
}

/** The caller supplies the configured Codeberg home, never a browser path. */
export async function openConfigDirectory(home: string): Promise<void> {
  const path = resolve(home);
  await mkdir(path, { recursive: true, mode: 0o700 });
  const { command, args, env } = configDirectoryCommand(path);
  await run(command, args, { env, timeout: 10000, maxBuffer: 8192 });
}
