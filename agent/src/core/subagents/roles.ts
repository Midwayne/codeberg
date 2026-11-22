import type { ToolSet } from 'ai';

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
 * Both roles may call every MCP tool. Explorers otherwise only read: code,
 * files, Git, saved context, web pages, job and schedule status, and the
 * canvas; their prompt tells them not to change anything. Workers may also
 * run scripts, start background jobs and schedules, edit the canvas, and
 * drive the browser, under the same permissions as the main agent.
 */
export function roleTools(type: SubagentType, tools: ToolSet): ToolSet {
  switch (type) {
    case 'worker':
      return tools;
    case 'explorer':
      return Object.fromEntries(Object.entries(tools).filter(([name]) => readsOnly(name)));
    default:
      return never(type);
  }
}

function readsOnly(name: string): boolean {
  if (ACTS.has(name)) return false;

  return !ACTING_PREFIXES.some(([prefix, reader]) => name.startsWith(prefix) && name !== reader);
}

function never(value: never): never {
  throw new Error(`Unknown subagent type: ${String(value)}`);
}
