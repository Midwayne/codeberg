import { jsonSchema, tool, type ModelMessage, type ToolSet } from 'ai';

import { isDeferredMcpTool } from '../mcp/active.js';

const LOAD = 'load_mcp_tools';

/**
 * A subagent's own `load_mcp_tools`. The main agent's version adds to an
 * activation shared by every chat on the same pooled agent; this one only
 * checks the names against the subagent's MCP tools. What it loaded lives in
 * the subagent's messages, and `withLocalLoads` adds those tools each step.
 */
export function localMcpLoads(tools: ToolSet): ToolSet {
  const shared = tools[LOAD];
  if (!shared) return tools;

  const callable = new Set(Object.keys(tools).filter(isDeferredMcpTool));

  return { ...tools, [LOAD]: tool({
    description: shared.description ?? 'Activate MCP tools so they can be called on the next step.',
    inputSchema: jsonSchema<{ names: string[] }>({ type: 'object', properties: {
      names: { type: 'array', items: { type: 'string' }, description: 'Callable MCP tool names, for example mcp_github_list_issues.' },
    }, required: ['names'] }),
    execute: async ({ names }) => {
      const requested = [...new Set((Array.isArray(names) ? names : []).filter((name) => typeof name === 'string').map((name) => name.trim()))];

      return {
        loaded: requested.filter((name) => callable.has(name)),
        missing: requested.filter((name) => !callable.has(name)),
        note: 'Loaded tools are callable on your next step.',
      };
    },
  }) };
}

/** Add the MCP tools this subagent loaded to the step's active tools, in tool order. */
export function withLocalLoads(active: string[] | undefined, all: readonly string[], messages: ModelMessage[]): string[] | undefined {
  if (!active) return undefined;

  const keep = new Set([...active, ...loadedIn(messages)]);

  return all.filter((name) => keep.has(name));
}

function loadedIn(messages: ModelMessage[]): string[] {
  return messages.flatMap((message) => {
    if (message.role !== 'tool') return [];

    return message.content.flatMap((part) => {
      if (part.type !== 'tool-result' || part.toolName !== LOAD || part.output.type !== 'json') return [];

      const loaded = (part.output.value as { loaded?: unknown } | null)?.loaded;

      return Array.isArray(loaded) ? loaded.filter((name): name is string => typeof name === 'string') : [];
    });
  });
}
