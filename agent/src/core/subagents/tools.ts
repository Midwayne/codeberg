import type { ToolSet } from 'ai';

import { SUBAGENT_TOOL_NAMES } from './names.js';

/**
 * Tools only the main agent may call: more subagents (no nesting),
 * `sleep_agent` (it ends the main agent's turn, which a subagent does not
 * own), and memory writes, whose evidence must quote a user message that a
 * subagent never sees.
 */
const MAIN_ONLY = new Set([...SUBAGENT_TOOL_NAMES, 'sleep_agent', 'remember', 'forget']);

/**
 * The tools a subagent may call: every tool the main agent has, including
 * background jobs, schedules, `load_mcp_tools`, the canvas, and the browser,
 * minus the main agent's own controls and anything that needs foreground
 * approval. Its role narrows this further (see `roleTools`).
 */
export function workerTools(tools: ToolSet): ToolSet {
  const kept: ToolSet = {};

  for (const [name, definition] of Object.entries(tools)) {
    if (MAIN_ONLY.has(name) || definition.needsApproval) continue;

    kept[name] = definition;
  }

  return kept;
}
