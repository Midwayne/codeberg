import { jsonSchema, tool, type ToolSet } from 'ai';
import { clampInt, collectFiles, readContext, readText, tailContext } from './files.js';

import type { ToolSource } from '../tools/source.js';
import type { ContextStore } from './store.js';

const MAX_GREP_MATCHES = 100;

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
    context_grep: grepTool(store),
    context_tail: tailTool(store),
    context_read: readTool(store),
  };
}

function grepTool(store: ContextStore) {
  return tool({
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
  });
}

function tailTool(store: ContextStore) {
  return tool({
    description:
      'Last lines of a dynamic-context file. Use on a spilled tool output or a terminal log before reading the whole file.',
    inputSchema: jsonSchema<{ path: string; lines?: number }>({
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path (relative to the context root, or absolute and allowed).',
        },
        lines: {
          type: 'integer',
          description: 'How many lines from the end (default 80, max 400).',
        },
      },
      required: ['path'],
    }),
    execute: async ({ path, lines }) => tailContext(store, path, lines),
  });
}

function readTool(store: ContextStore) {
  return tool({
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
  });
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
