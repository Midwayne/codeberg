import type { ToolSet } from 'ai';

import { isBackgroundControl } from '../background/names.js';
import { SUBAGENT_TOOL_NAMES } from './names.js';

/** Tools that act for the user, drive shared UI, or start more agents. */
const EXCLUDED = new Set([...SUBAGENT_TOOL_NAMES, 'remember', 'forget']);

const EXCLUDED_PREFIXES = ['canvas_', 'browser_'];

/**
 * The tools a subagent may call: everything the main agent investigates
 * with, minus agent controls (scheduling, sleeping, background jobs, more
 * subagents, and `load_mcp_tools`, whose activation is shared with the main
 * agent), the shared canvas and browser, memory writes that must quote the
 * user, and anything that needs foreground approval. Subagents call the MCP
 * tools the main agent has loaded that their role allows.
 */
export function workerTools(tools: ToolSet): ToolSet {
  const kept: ToolSet = {};

  for (const [name, definition] of Object.entries(tools)) {
    if (!allowed(name) || definition.needsApproval) continue;

    kept[name] = definition;
  }

  return kept;
}

function allowed(name: string): boolean {
  if (EXCLUDED.has(name)) return false;

  if (EXCLUDED_PREFIXES.some((prefix) => name.startsWith(prefix))) return false;

  return !isBackgroundControl(name);
}
