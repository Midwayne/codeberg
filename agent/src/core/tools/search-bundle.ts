import { jsonSchema, tool } from 'ai';
import type { DaemonClient } from '../client.js';
import type { SearchResult } from '../types.js';
import type { ToolSource } from './source.js';
import { collectBundle } from './search-bundle/collect.js';
import type { BundleInput } from './search-bundle/types.js';

/** Experimental declarative search composition; no scripts, writes, MCPs, or arbitrary tools. */
export function searchBundleSource(options: { daemon: DaemonClient; onResults: (hits: SearchResult[]) => void }): ToolSource {
  return { name: 'search_bundle', tools: () => ({ search_bundle: tool({
    description: 'Experimental read-only evidence bundle. Search up to four explicit repository/query pairs, '
      + 'collect matching symbols, and fetch selected indexed chunks in one call. Results and failures share a bounded output. '
      + 'Use for cross-repository investigations. It cannot execute code or change source files.',
    inputSchema: jsonSchema<BundleInput>({ type: 'object', additionalProperties: false, required: ['queries'],
      properties: { queries: { type: 'array', minItems: 1, maxItems: 4, items: {
        type: 'object', additionalProperties: false, required: ['repo', 'query'], properties: {
          repo: { type: 'string', minLength: 1, maxLength: 128 },
          query: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      } } },
    }),
    execute: async (input, execution) => {
      const bundle = await collectBundle(options.daemon, input, execution.abortSignal);
      options.onResults(bundle.evidence);

      return bundle;
    },
  }) }) };
}
