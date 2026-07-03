import { jsonSchema, tool, type ToolSet } from "ai";

import type { DaemonClient } from "../client.js";
import type { SearchResult } from "../types.js";
import type { ToolSource } from "./source.js";

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
    name: "search_code",
    tools: (): ToolSet => ({
      search_code: tool({
        description:
          "Semantic code search. Returns relevant chunks with path, lines, and snippet. " +
          "Searches every indexed repo unless `repo` narrows it to one (keys via the repos tool).",
        inputSchema: jsonSchema<{ query: string; k?: number; repo?: string }>({
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string" },
            k: { type: "number", description: "max results (default 8)" },
            repo: { type: "string", description: "restrict to one repo key (optional)" },
          },
          required: ["query"],
        }),
        execute: async ({ query, k, repo }) => {
          const results = await opts.daemon.search(query, {
            k: k ?? opts.defaultK,
            repo,
          });
          opts.onResults(results);
          return results.map(toToolChunk);
        },
      }),
    }),
  };
}

function toToolChunk(r: SearchResult): Record<string, unknown> {
  return {
    id: r.id,
    // The repo key lets the model pass matching `repo` args to read_file/grep.
    ...(r.repo ? { repo: r.repo } : {}),
    path: r.path,
    symbol: r.symbol,
    lines: `${r.start_line}-${r.end_line}`,
    snippet: r.snippet,
  };
}
