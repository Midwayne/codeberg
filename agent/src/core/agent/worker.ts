import type { SubagentWorker } from '../subagents/loop.js';
import type { AgentState } from './state.js';
import { subagentsEnabled } from '../subagents/config.js';

/**
 * Subagents run on their own model when one is chosen, else the summary
 * model, else the subagent model, else the chat model with its effort.
 * They see the repositories and MCP server listing, and MCP schemas follow
 * the same activation as the main loop.
 */
export function subagentWorker(state: AgentState): SubagentWorker {
  const { subagents, summaryModel, summaryReasoning, subagentModel } = state.options;
  const candidates: Array<Omit<SubagentWorker, 'activeTools'> | undefined> = [
    subagents?.model && { model: subagents.model, reasoning: subagents.reasoning, profile: subagents.profile ?? state.summaryProfile },
    summaryModel && { model: summaryModel, reasoning: summaryReasoning, profile: state.summaryProfile },
    subagentModel && { model: subagentModel, profile: state.summaryProfile },
  ];
  const chosen = candidates.find(Boolean) ?? { model: state.model, reasoning: state.reasoning, profile: state.profile };

  return {
    ...chosen,
    context: () => state.subagentContext,
    activeTools: (all, messages) => state.mcpSource?.activeTools(all, messages),
  };
}

/** The Models switch wins; without one, CODEBERG_SUBAGENTS_USE decides. */
export function subagentsOn(state: AgentState): boolean {
  return state.options.subagents?.enabled ?? subagentsEnabled(state.env);
}
