import type { ToolSet } from 'ai';

import { DaemonClient } from '../client.js';
import { ContextStore } from '../context/store.js';
import { contextToolSource } from '../context/tools.js';
import { extractEvidence } from '../evidence-extract.js';
import type { McpToolSource } from '../mcp/tools.js';
import type { SearchResult } from '../types.js';
import type { WebConfig } from '../web/types.js';
import { collectTools, daemonToolSource, searchCodeSource, webToolSource } from './index.js';

interface AgentToolOptions {
  daemon: DaemonClient;
  context: ContextStore;
  web: WebConfig;
  mcp: () => McpToolSource;
  defaultSearchK: number;
  onResults: (hits: SearchResult[]) => void;
}

/** Owns tool ordering and evidence extraction for every agent turn. */
export async function createAgentTools(opts: AgentToolOptions): Promise<ToolSet> {
  // search_code stays first so it cannot be shadowed by another source.
  return collectTools([
    searchCodeSource({
      daemon: opts.daemon,
      defaultK: opts.defaultSearchK,
      onResults: opts.onResults,
    }),
    contextToolSource(opts.context),
    daemonToolSource({
      daemon: opts.daemon,
      onToolResult: (name, output) => {
        const hits = extractEvidence(name, output);
        if (hits.length > 0) {
          opts.onResults(hits);
        }
      },
    }),
    webToolSource(opts.web),
    opts.mcp(),
  ]);
}
