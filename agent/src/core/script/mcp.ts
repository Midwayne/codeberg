import type { ToolSet } from 'ai';

import { isDeferredMcpTool } from '../mcp/active.js';
import type { McpToolSource } from '../mcp/tools/state.js';
import { recordToolExecutions } from '../runs/tools.js';

export interface ScriptMcpOptions {
  tools: ToolSet;
  source: Pick<McpToolSource, 'activeToolNames' | 'reports'> | undefined;
  /** Config server names whose tools scripts may call without a read-only mark. */
  trusted: readonly string[];
}

/**
 * MCP tools a script may call right now. A tool qualifies only after the agent
 * loaded it with `load_mcp_tools`, so the model has read its arguments, and
 * only when its server marks it read-only or the user trusts that server.
 * The read-only mark is the server's own claim about its tool.
 */
export function scriptMcpNames(opts: ScriptMcpOptions): string[] {
  if (!opts.source) return [];

  const serverOf = serverByTool(opts.source);
  const trusted = new Set(opts.trusted);

  return opts.source.activeToolNames()
    .filter((name) => isDeferredMcpTool(name) && name in opts.tools)
    .filter((name) => isReadOnly(opts.tools[name]) || trusted.has(serverOf.get(name) ?? ''))
    .sort();
}

/** The MCP tools in `tools`, each call journaled: their effects reach outside
 *  Codeberg, so every script call keeps its own run record. */
export function recordedMcpTools(tools: ToolSet): ToolSet {
  const mcp = Object.entries(tools).filter(([name]) => isDeferredMcpTool(name));

  return recordToolExecutions(Object.fromEntries(mcp));
}

/** The message of an MCP `isError` result, or undefined for any other result. */
export function mcpErrorText(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;

  const { isError, content } = result as { isError?: unknown; content?: unknown };
  if (isError !== true) return undefined;

  const text = Array.isArray(content)
    ? content.flatMap((part) => (part?.type === 'text' && typeof part.text === 'string' ? [part.text] : []))
    : [];

  return text.join('\n').trim() || 'the MCP tool reported an error';
}

function serverByTool(source: Pick<McpToolSource, 'reports'>): Map<string, string> {
  const out = new Map<string, string>();

  for (const report of source.reports()) {
    for (const listing of report.tools) out.set(listing.callable, report.name);
  }

  return out;
}

export function isReadOnly(definition: ToolSet[string] | undefined): boolean {
  const metadata = (definition as { metadata?: { annotations?: { readOnlyHint?: unknown } } } | undefined)?.metadata;

  return metadata?.annotations?.readOnlyHint === true;
}
