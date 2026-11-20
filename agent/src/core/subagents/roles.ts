import type { ToolSet } from 'ai';

import { isDeferredMcpTool } from '../mcp/active.js';
import { isReadOnly } from '../script/mcp.js';
import { SCRIPT_TOOL } from '../script/tool.js';

export const SUBAGENT_TYPES = ['explorer', 'worker'] as const;

export type SubagentType = (typeof SUBAGENT_TYPES)[number];

/**
 * Explorers only read: code, files, Git, saved context, web pages, and MCP
 * tools their server marks read-only. Workers may also run scripts and call
 * any loaded MCP tool, under the same permissions as the main agent.
 */
export function roleTools(type: SubagentType, tools: ToolSet): ToolSet {
  switch (type) {
    case 'worker':
      return tools;
    case 'explorer':
      return Object.fromEntries(Object.entries(tools).filter(([name, definition]) => readsOnly(name, definition)));
    default:
      return never(type);
  }
}

function readsOnly(name: string, definition: ToolSet[string]): boolean {
  if (name === SCRIPT_TOOL) return false;

  return !isDeferredMcpTool(name) || isReadOnly(definition);
}

function never(value: never): never {
  throw new Error(`Unknown subagent type: ${String(value)}`);
}
