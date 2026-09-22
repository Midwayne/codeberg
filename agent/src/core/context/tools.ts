import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { jsonSchema, tool, type ToolSet } from 'ai';

import type { ContextStore } from './store.js';
import type { ToolSource } from '../tools/source.js';

const MAX_GREP_MATCHES = 100;
const MAX_GREP_FILES = 2_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_READ_LINES = 400;
const MAX_TAIL_LINES = 400;
const MAX_WALK_DEPTH = 8;
const SKIP_DIRS = new Set(['node_modules', '.git']);

/**
 * Tools that read the dynamic-context files (spilled output, history, MCP
 * catalogs, terminal logs, skills). Paths cannot escape the store's allowed
 * roots. The daemon's read_file/grep stay repo-scoped; these do not.
 */
export function contextToolSource(store: ContextStore): ToolSource {
  return {
    name: 'context',
    tools: (): ToolSet => contextTools(store),
  };
}

export function contextTools(store: ContextStore): ToolSet {
  return {
    context_grep: tool({
      description:
        'Search dynamic-context files (spilled tool output, history transcripts, ' +
        'MCP catalogs, terminal logs, skill files). Returns path:line:text. ' +
        'Use this to recover detail that was summarized or spilled out of the prompt.',
      inputSchema: jsonSchema<{
        pattern: string;
        path?: string;
        literal?: boolean;
        limit?: number;
      }>({
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Text or regular expression to find.' },
          path: {
            type: 'string',
            description:
              'File or directory. Relative paths are under the context root. Omit to search the whole context root.',
          },
          literal: {
            type: 'boolean',
            description: 'Plain text when true (default). Regular expression when false.',
          },
          limit: { type: 'integer', description: 'Maximum matches (default 40, max 100).' },
        },
        required: ['pattern'],
      }),
      execute: async ({ pattern, path, literal, limit }) =>
        grepContext(store, { pattern, path, literal, limit }),
    }),
    context_tail: tool({
      description:
        'Last lines of a dynamic-context file. Use on a spilled tool output or a terminal log before reading the whole file.',
      inputSchema: jsonSchema<{ path: string; lines?: number }>({
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (relative to the context root, or absolute and allowed).' },
          lines: { type: 'integer', description: 'How many lines from the end (default 80, max 400).' },
        },
        required: ['path'],
      }),
      execute: async ({ path, lines }) => tailContext(store, path, lines),
    }),
    context_read: tool({
      description:
        'Read a dynamic-context file, or list a directory. Line numbers are 1-based. ' +
        'A directory listing shows one folder of MCP tools, skill files, or terminal logs together.',
      inputSchema: jsonSchema<{ path: string; start_line?: number; end_line?: number }>({
        type: 'object',
        properties: {
          path: { type: 'string' },
          start_line: { type: 'integer', description: 'First line to return (1-based).' },
          end_line: { type: 'integer', description: 'Last line to return, inclusive.' },
        },
        required: ['path'],
      }),
      execute: async ({ path, start_line, end_line }) =>
        readContext(store, path, start_line, end_line),
    }),
  };
}

interface GrepInput {
  pattern: string;
  path?: string;
  literal?: boolean;
  limit?: number;
}

async function grepContext(store: ContextStore, input: GrepInput): Promise<string> {
  const pattern = input.pattern ?? '';
  if (!pattern) return 'error: pattern is required';
  if (pattern.length > 500) return 'error: pattern is too long';
  const literal = input.literal !== false;
  let regex: RegExp;
  try {
    regex = new RegExp(literal ? escapeRegExp(pattern) : pattern);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `error: invalid regular expression: ${message}`;
  }
  const limit = clampInt(input.limit, 40, MAX_GREP_MATCHES);
  const start = input.path && input.path.length > 0 ? input.path : '.';
  const files = await collectFiles(store, start);
  if (files.length === 0) return 'error: path not found or not allowed';

  const matches: string[] = [];
  const notes: string[] = [];
  for (const file of files) {
    if (matches.length >= limit) break;
    const text = await readText(file);
    if (text == null) {
      notes.push(`skipped (unreadable or too large): ${file}`);
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= limit) break;
      const line = lines[i] ?? '';
      if (!regex.test(line)) continue;
      regex.lastIndex = 0;
      matches.push(`${file}:${i + 1}:${line}`);
    }
    regex.lastIndex = 0;
  }
  if (matches.length === 0 && notes.length === 0) return 'no matches';
  return [...matches, ...notes].join('\n');
}

async function tailContext(store: ContextStore, path: string, lines: number | undefined): Promise<string> {
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

async function readContext(
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
  const end = endLine == null ? defaultEnd : Math.min(all.length, clampInt(endLine, defaultEnd, all.length));
  const span = Math.min(Math.max(end, start + 1), start + MAX_READ_LINES);
  const slice = all.slice(start, span);
  const body = formatLines(slice, start + 1);
  if (span < all.length) {
    return `${body}\n[${all.length} lines total; pass start_line/end_line or use context_grep]`;
  }
  return body;
}

function formatLines(lines: string[], firstLineNumber: number): string {
  return lines.map((line, i) => `${firstLineNumber + i}|${line}`).join('\n');
}

async function collectFiles(store: ContextStore, requested: string): Promise<string[]> {
  const real = store.resolve(requested);
  if (!real) return [];
  const info = await stat(real);
  if (info.isFile()) return [real];
  if (!info.isDirectory()) return [];
  const out: string[] = [];
  await walkFiles(store, real, 0, out);
  return out;
}

async function walkFiles(
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

async function readText(file: string): Promise<string | null> {
  const info = await stat(file);
  if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;
  const text = await readFile(file, 'utf8');
  if (text.includes('\0')) return null;
  return text;
}

function clampInt(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
  if (n < 1) return 1;
  return Math.min(n, max);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
