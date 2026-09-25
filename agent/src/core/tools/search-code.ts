import { jsonSchema, tool, type ToolSet } from 'ai';

import { formatLineRange } from '../search-hit.js';
import type { DaemonClient } from '../client.js';
import type { SearchResult } from '../types.js';
import type { ToolSource } from './source.js';
import { daemonToolError } from './daemon-error.js';

const MAX_EXPANDED_HITS = 3;
const MAX_BODY_CHARS_PER_HIT = 2_500;
const MAX_BODY_CHARS_TOTAL = 6_000;

export interface SearchCodeOptions {
  daemon: DaemonClient;
  /** Result count when the model doesn't specify one. */
  defaultK: number;
  /**
   * Sink for the full hits behind each search. The tool reports them here so the
   * caller (the Agent) can build its answer's source list and evidence ledger —
   * the tool no longer reaches into the Agent's fields to record what it found.
   */
  onResults: (hits: SearchResult[]) => void;
}

/**
 * The built-in semantic code-search tool, as a tool source. It owns its result
 * capture: full hits go to `onResults`, while the model receives only the
 * compact chunk shape (token-efficient).
 */
export function searchCodeSource(opts: SearchCodeOptions): ToolSource {
  return {
    name: 'search_code',
    tools: (): ToolSet => ({
      search_code: tool({
        description:
          'Semantic code search. Returns relevant chunks with path, lines, snippet, and bounded full bodies for the top hits. ' +
          'Searches every indexed repo unless `repo` narrows it to one (keys via the repos tool).',
        inputSchema: jsonSchema<{
          query: string;
          k?: number;
          repo?: string;
          path_glob?: string;
          kind?: string;
          min_score?: number;
        }>({
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string' },
            k: { type: 'number', description: 'max results (default 8)' },
            repo: {
              type: 'string',
              description: 'restrict to one repo key (optional)',
            },
            path_glob: {
              type: 'string',
              description: 'fnmatch glob on chunk paths',
            },
            kind: {
              type: 'string',
              description: 'chunk kind: function, method, class, struct, interface, window, section, key',
            },
            min_score: {
              type: 'number',
              description: 'minimum similarity score (0-1)',
            },
          },
          required: ['query'],
        }),
        execute: async ({ query, k, repo, path_glob, kind, min_score }) => {
          try {
            const results = await opts.daemon.search(query, {
              k: k ?? opts.defaultK,
              repo,
              path_glob,
              kind,
              min_score,
            });
            opts.onResults(results);
            const selected = selectExpansionHits(results, query);
            const bodies = await Promise.all(
              selected.map(async (i) => {
                const hit = results[i];
                try {
                  const detail = await opts.daemon.callTool('get_chunk', {
                    repo: hit.repo,
                    id: hit.id,
                  });
                  return detail && typeof detail === 'object' && 'body' in detail &&
                    typeof detail.body === 'string'
                    ? { body: detail.body, truncated: 'truncated' in detail && detail.truncated === true }
                    : undefined;
                } catch {
                  // Indexes can change between search and chunk lookup. The original
                  // hit remains usable even when its expansion fails.
                  return undefined;
                }
              }),
            );
            let remaining = MAX_BODY_CHARS_TOTAL;
            const expanded = new Map<number, { body: string; truncated: boolean }>();
            for (let n = 0; n < selected.length; n++) {
              const detail = bodies[n];
              if (!detail?.body || remaining <= 0) continue;
              const body = detail.body.slice(0, Math.min(MAX_BODY_CHARS_PER_HIT, remaining));
              remaining -= body.length;
              expanded.set(selected[n], {
                body,
                truncated: detail.truncated || body.length < detail.body.length,
              });
            }
            return results.map((hit, i) => ({ ...toToolChunk(hit), ...expanded.get(i) }));
          } catch (error) {
            return daemonToolError(error);
          }
        },
      }),
    }),
  };
}

function selectExpansionHits(results: SearchResult[], query: string): number[] {
  const stop = new Set(['the', 'and', 'for', 'how', 'what', 'where', 'with', 'from', 'does', 'into']);
  const terms = [...new Set((query.toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) ?? [])
    .filter((term) => !stop.has(term)))];
  return results
    .map((hit, i) => {
      const path = hit.path.toLowerCase();
      const content = `${hit.symbol} ${hit.snippet}`.toLowerCase();
      const overlap = terms.reduce((score, term) =>
        score + (path.includes(term) ? 0.012 : 0) + (content.includes(term) ? 0.025 : 0), 0);
      return { i, score: hit.score + overlap };
    })
    .filter(({ i }) => Boolean(results[i].repo && results[i].id))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, MAX_EXPANDED_HITS)
    .map(({ i }) => i);
}

function toToolChunk(r: SearchResult): Record<string, unknown> {
  return {
    id: r.id,
    // The repo key lets the model pass matching `repo` args to read_file/grep/get_chunk.
    ...(r.repo ? { repo: r.repo } : {}),
    path: r.path,
    symbol: r.symbol,
    lines: formatLineRange(r),
    score: r.score,
    snippet: r.snippet,
  };
}
