import type { ToolSet } from 'ai';

import { isDeferredMcpTool } from '../mcp/active.js';
import { isReadOnly } from '../script/mcp.js';
import { SCRIPT_TOOL } from '../script/tool.js';

export const SUBAGENT_TYPES = ['explorer', 'worker'] as const;

export type SubagentType = (typeof SUBAGENT_TYPES)[number];

/**
 * Tools that start or change something. Explorers keep the matching readers:
 * background_tool_status, list_scheduled_runs, canvas_get, browser_sessions.
 */
const ACTS = new Set([SCRIPT_TOOL, 'start_background_tool', 'cancel_background_tool', 'schedule_run', 'cancel_scheduled_run']);

const ACTING_PREFIXES: ReadonlyArray<[prefix: string, reader: string]> = [['canvas_', 'canvas_get'], ['browser_', 'browser_sessions']];

/**
 * Explorers only read: code, files, Git, saved context, web pages, job and
 * schedule status, the canvas, and MCP tools their server marks read-only,
 * so text they read cannot make them change anything. Workers may also run
 * scripts, start background jobs and schedules, edit the canvas, drive the
 * browser, and call every MCP tool, under the same permissions as the main agent.
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
  if (ACTS.has(name)) return false;

  if (ACTING_PREFIXES.some(([prefix, reader]) => name.startsWith(prefix) && name !== reader)) return false;

  return !isDeferredMcpTool(name) || isReadOnly(definition);
}

function never(value: never): never {
  throw new Error(`Unknown subagent type: ${String(value)}`);
}
