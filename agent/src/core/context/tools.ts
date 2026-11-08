import { jsonSchema, tool, type ToolSet } from 'ai';
import { readContext, tailContext } from './files.js';

import { MAX_REGEX_GROUP_DEPTH } from './grep-regex.js';
import { grepContext, MAX_GREP_PATTERN } from './grep.js';

import type { ToolSource } from '../tools/source.js';
import type { ContextStore } from './store.js';

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
      'MCP catalogs, terminal logs, skill files). Searches one line at a time and returns path:line:text. ' +
      'Use this to recover detail that was summarized or spilled out of the prompt.',
    inputSchema: jsonSchema<{
      pattern: string;
      path?: string;
      literal?: boolean;
      limit?: number;
    }>({
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          minLength: 1,
          maxLength: MAX_GREP_PATTERN,
          description: `Text or JavaScript regular expression to find within one line (up to ${MAX_GREP_PATTERN} UTF-16 code units). Regexes support up to ${MAX_REGEX_GROUP_DEPTH} nested groups.`,
        },
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
    execute: async (input, { abortSignal }) => grepContext(store, input, abortSignal),
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
    inputSchema: jsonSchema<{ path: string; start_line?: number; end_line?: number; start_column?: number }>({
      type: 'object',
      properties: {
        path: { type: 'string' },
        start_line: { type: 'integer', description: 'First line to return (1-based).' },
        end_line: { type: 'integer', description: 'Last line to return, inclusive.' },
        start_column: { type: 'integer', description: '1-based UTF-16 position in the first line; use the returned continuation position for long lines.' },
      },
      required: ['path'],
    }),
    execute: async ({ path, start_line, end_line, start_column }) =>
      readContext(store, path, start_line, end_line, start_column),
  });
}
