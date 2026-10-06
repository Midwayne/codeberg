import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContextStore } from './store.js';

export const MAX_GREP_FILES = 2_000;

export const MAX_FILE_BYTES = 8 * 1024 * 1024;

export const MAX_READ_LINES = 400;

export const MAX_TAIL_LINES = 400;

export const MAX_WALK_DEPTH = 8;

export const SKIP_DIRS = new Set(['node_modules', '.git']);

export async function tailContext(
  store: ContextStore,
  path: string,
  lines: number | undefined,
): Promise<string> {
  const real = store.resolve(path);
  if (!real) return 'error: path not found or not allowed';

  const info = await stat(real);
  if (!info.isFile()) return 'error: path is not a file';

  const text = await readText(real);
  if (text == null) return 'error: file is unreadable or too large';

  const all = text.split(/\r?\n/);
  const n = clampInt(lines, 80, MAX_TAIL_LINES);
  const start = Math.max(0, all.length - n);

  return formatLines(all.slice(start), start + 1);
}

export async function readContext(
  store: ContextStore,
  path: string,
  startLine: number | undefined,
  endLine: number | undefined,
): Promise<string> {
  const real = store.resolve(path);
  if (!real) return 'error: path not found or not allowed';

  const info = await stat(real);
  if (info.isDirectory()) {
    const entries = await readdir(real, { withFileTypes: true });
    const names = entries
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .sort();

    return names.slice(0, 500).join('\n');
  }

  if (!info.isFile()) return 'error: path is not a file';

  const text = await readText(real);
  if (text == null) return 'error: file is unreadable or too large';

  const all = text.split(/\r?\n/);
  const start = clampInt(startLine, 1, all.length) - 1;
  const defaultEnd = Math.min(all.length, start + 200);
  const end =
    endLine == null ? defaultEnd : Math.min(all.length, clampInt(endLine, defaultEnd, all.length));
  const span = Math.min(Math.max(end, start + 1), start + MAX_READ_LINES);
  const slice = all.slice(start, span);
  const body = formatLines(slice, start + 1);
  if (span < all.length) {
    return `${body}\n[${all.length} lines total; pass start_line/end_line or use context_grep]`;
  }

  return body;
}

export function formatLines(lines: string[], firstLineNumber: number): string {
  return lines.map((line, i) => `${firstLineNumber + i}|${line}`).join('\n');
}

export async function collectFiles(store: ContextStore, requested: string): Promise<string[]> {
  const real = store.resolve(requested);
  if (!real) return [];

  const info = await stat(real);
  if (info.isFile()) return [real];

  if (!info.isDirectory()) return [];

  const out: string[] = [];
  await walkFiles(store, real, 0, out);

  return out;
}

export async function walkFiles(
  store: ContextStore,
  dir: string,
  depth: number,
  out: string[],
): Promise<void> {
  if (depth > MAX_WALK_DEPTH || out.length >= MAX_GREP_FILES) return;

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= MAX_GREP_FILES) return;

    if (SKIP_DIRS.has(entry.name)) continue;

    const child = store.resolve(join(dir, entry.name));
    if (!child) continue;

    if (entry.isDirectory()) {
      await walkFiles(store, child, depth + 1, out);
    } else if (entry.isFile()) {
      out.push(child);
    }
  }
}

export async function readText(file: string): Promise<string | null> {
  const info = await stat(file);
  if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;

  const text = await readFile(file, 'utf8');
  if (text.includes('\0')) return null;

  return text;
}

export function clampInt(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
  if (n < 1) return 1;

  return Math.min(n, max);
}
