import { jsonSchema, tool, type ToolSet } from 'ai';

import { fetchUrl } from './client.js';
import { webSearchProviderFromConfig } from './search/index.js';
import type { WebConfig, WebDeps } from './types.js';

/** Hard ceiling on requested search results, independent of the configured default. */
const MAX_SEARCH_COUNT = 10;

/**
 * Build the agent's web tools from config. Returns an empty set when web use is
 * disabled. `fetch_url` is always present when enabled (no backend needed);
 * `web_search` only when a SearXNG endpoint is configured. `deps` injects the
 * fetch implementation for tests.
 */
export function webTools(config: WebConfig, deps?: WebDeps): ToolSet {
  if (!config.enabled) return {};

  const tools: ToolSet = {
    fetch_url: tool({
      description:
        'Fetch an http(s) web page or text/JSON resource and return its readable text. ' +
        'Use to read external documentation, RFCs, changelogs, issue threads, or any URL ' +
        'found in the code or in a web_search result. Private/loopback hosts are blocked; ' +
        'long pages are truncated.',
      inputSchema: jsonSchema<{ url: string }>({
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', description: 'Absolute http(s) URL to fetch' },
        },
        required: ['url'],
      }),
      execute: async ({ url }) => fetchUrl(url, config, deps),
    }),
  };

  const provider = webSearchProviderFromConfig(config, deps);
  if (provider) {
    tools.web_search = tool({
      description:
        'Search the public web for documentation, API references, error ' +
        'explanations, specs, or library sources. Returns ranked results with ' +
        'title, url, and snippet — then use fetch_url to read the most relevant one.',
      inputSchema: jsonSchema<{ query: string; count?: number }>({
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', description: 'Search query' },
          count: {
            type: 'number',
            description: `max results (default ${config.searchCount}, max ${MAX_SEARCH_COUNT})`,
          },
        },
        required: ['query'],
      }),
      execute: async ({ query, count }) => {
        const n = Math.min(Math.max(1, count ?? config.searchCount), MAX_SEARCH_COUNT);
        return { results: await provider.search(query, { count: n }) };
      },
    });
  }

  return tools;
}
