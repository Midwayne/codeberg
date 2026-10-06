import { existsSync, readFileSync } from 'node:fs';

export function defaultExists(path: string): boolean {
  return existsSync(path);
}

export function defaultReadFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
