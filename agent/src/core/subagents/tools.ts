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

    kept[name] = name === 'schedule_run' ? timeBasedSchedules(definition) : definition;
  }

  return kept;
}

type Execute = (input: unknown, options: unknown) => unknown;

/**
 * A subagent's tool calls are not recorded in the chat run, so a schedule
 * waiting on one of them (`after_tool_call_id`) could never find its outcome.
 */
function timeBasedSchedules(definition: ToolSet[string]): ToolSet[string] {
  const execute = definition.execute as Execute | undefined;
  if (!execute) return definition;

  return { ...definition, execute: async (input: unknown, options: unknown) => {
    if ((input as { after_tool_call_id?: unknown } | undefined)?.after_tool_call_id !== undefined) {
      throw new Error('after_tool_call_id is not available to subagents, whose tool calls are not recorded in the chat. ' +
        'Use delay_seconds or run_at.');
    }

    return execute.call(definition, input, options);
  } } as ToolSet[string];
}
