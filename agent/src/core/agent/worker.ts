import type { LanguageModel } from 'ai';

import type { ModelProfile } from '../../providers/profiles.js';
import { HISTORY_SUMMARY_SYSTEM } from '../prompts/history-summary.js';
import { manageContextModel } from '../request-budget/model.js';
import type { SubagentWorker } from '../subagents/loop.js';
import { subagentMaxSteps, subagentsEnabled } from '../subagents/config.js';
import { summarize } from './history.js';
import { modelLiveness } from './liveness.js';
import { modelTimeout } from './model-timeout.js';
import type { AgentState } from './state.js';

/**
 * Subagents run on their own model when one is chosen, else the summary
 * model, else the subagent model, else the chat model with its effort.
 * They see the repositories and MCP server listing, and MCP schemas follow
 * the same activation as the main loop. Like the main loop they have no time
 * limit: only a silent provider request fails, and older tool output is
 * summarized as their context fills, so a long investigation can finish.
 */
export function subagentWorker(state: AgentState): SubagentWorker {
  const { subagents, summaryModel, summaryReasoning, subagentModel } = state.options;
  const candidates: Array<Omit<SubagentWorker, 'activeTools'> | undefined> = [
    subagents?.model && { model: subagents.model, reasoning: subagents.reasoning, profile: subagents.profile ?? state.summaryProfile },
    summaryModel && { model: summaryModel, reasoning: summaryReasoning, profile: state.summaryProfile },
    subagentModel && { model: subagentModel, profile: state.summaryProfile },
  ];
  const chosen = candidates.find(Boolean) ?? { model: state.model, reasoning: state.reasoning, profile: state.profile };

  const maxSteps = subagentMaxSteps(state.env);

  return {
    ...chosen,
    model: longRunning(state, chosen.model, chosen.profile),
    ...(maxSteps ? { maxSteps } : {}),
    context: () => state.subagentContext,
    activeTools: (all, messages) => state.mcpSource?.activeTools(all, messages),
  };
}

/** The Models switch wins; without one, CODEBERG_SUBAGENTS_USE decides. */
export function subagentsOn(state: AgentState): boolean {
  return state.options.subagents?.enabled ?? subagentsEnabled(state.env);
}

function longRunning(state: AgentState, model: LanguageModel, profile: ModelProfile) {
  const managed = manageContextModel(model, {
    profile,
    context: state.context,
    summarize: (transcript, limit, signal) => summarize(state, transcript, limit, signal),
    checkpointPolicy: JSON.stringify(['subagent', state.summaryProfile, HISTORY_SUMMARY_SYSTEM]),
  });

  return modelTimeout(managed, modelLiveness(state.env));
}
