import type { ToolSet } from 'ai';

import { usesCompactPrompt, type ModelProfile } from '../../providers/profiles.js';
import { CONTEXT_CONTROL_TOOLS } from '../request-budget/tools.js';

/** Automatic clearing covers these; choosing what to keep is a judgment small models make worse. */
const SMALL_WINDOW_HIDDEN_TOOLS: ReadonlySet<string> = new Set(CONTEXT_CONTROL_TOOLS);

/**
 * Built-in tools a `light` model does not see. Small models choose worse from
 * a long tool list, so they keep the core search, read, graph, context, web,
 * and MCP tools. Delegation, scheduling, background jobs, history recall, and
 * tools that a pipe already covers are hidden. Tools the user turns on
 * explicitly (scripts, canvas, browser, MCP servers) stay offered.
 */
export const LIGHT_HIDDEN_TOOLS: ReadonlySet<string> = new Set([
  'decide',
  'run_subagents',
  'message_subagent',
  'schedule_run',
  'list_scheduled_runs',
  'cancel_scheduled_run',
  'sleep_agent',
  'start_background_tool',
  'background_tool_status',
  'cancel_background_tool',
  'search_learning',
  'detect_changes',
  'get_architecture',
  'git_log',
  'git_blame',
  'head',
  'tail',
  'wc',
  ...CONTEXT_CONTROL_TOOLS,
]);

/**
 * The tools offered to this profile's model, in their original order. Small
 * working windows drop the context-control tools: their schemas and guidance
 * would take more room than choosing what to clear saves.
 */
export function toolsForTier(tools: ToolSet, profile: ModelProfile): ToolSet {
  const hidden = profile.tier === 'light' ? LIGHT_HIDDEN_TOOLS : usesCompactPrompt(profile) ? SMALL_WINDOW_HIDDEN_TOOLS : undefined;
  if (!hidden) return tools;

  const kept = Object.entries(tools).filter(([name]) => !hidden.has(name));

  return Object.fromEntries(kept) as ToolSet;
}
