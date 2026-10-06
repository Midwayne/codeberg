import { jsonSchema, tool, type ToolSet } from 'ai';
import type { SourceState } from './state.js';

export function loadMcpTools(state: SourceState): ToolSet[string] {
  return tool({
    description:
      'Activate MCP tools so they can be called on the next step. Pass callable names ' +
      '(mcp_<server>_<tool>). Read the server folder or a tool JSON file first when the ' +
      'name alone does not tell you the arguments. Unavailable servers are listed in the ' +
      'prompt; do not expect their tools to load.',
    inputSchema: jsonSchema<{ names: string[] }>({
      type: 'object',
      properties: {
        names: {
          type: 'array',
          items: { type: 'string' },
          description: 'Callable MCP tool names, for example mcp_github_list_issues.',
        },
      },
      required: ['names'],
    }),
    execute: async ({ names }) => {
      const result = state.activation.activate(Array.isArray(names) ? names : []);
      const unavailable = state.opened
        .filter((opened) => opened.catalog.state === 'unavailable')
        .map((opened) => ({
          server: opened.catalog.serverName,
          error: opened.catalog.detail ?? 'unavailable',
        }));

      return {
        loaded: result.loaded,
        missing: result.missing,
        catalogs: result.loaded.flatMap((name) => {
          const file = state.published?.files.get(name);

          return file ? [file] : [];
        }),
        unavailable,
        note: 'Loaded tools are callable on your next step. Read a catalog file before inventing arguments.',
      };
    },
  });
}
