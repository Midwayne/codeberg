import type { ModelMessage } from 'ai';
import { historyBudget } from '../../providers/profiles.js';
import { externalizeToolResults } from '../context/externalize.js';
import { HISTORY_SUMMARY_SYSTEM } from '../prompts/history-summary.js';
import type { AgentState } from './state.js';
import { summarizeWithinWindow } from './summary.js';

export async function compactHistory(
  state: AgentState,
  messages: ModelMessage[],
): Promise<ModelMessage[]> {
  // Recoverable tool output is cheaper to move to disk than to summarize.
  // Size the prepared transcript so a large resumed result cannot cause an
  // otherwise unnecessary model call or fill the summarizer's input.
  const prepared = await externalizeToolResults(messages, state.context);

  return state.checkpoints.fit(prepared, {
    budget: historyBudget(state.profile),
    summarize: (transcript) => summarize(state, transcript),
    archive: (transcript) => state.context.writeHistory(transcript),
  }, JSON.stringify([state.profile, state.summaryProfile, HISTORY_SUMMARY_SYSTEM]));
}

export function historyCompactor(
  state: AgentState,
): (messages: ModelMessage[]) => Promise<ModelMessage[]> {
  return (messages) => compactHistory(state, messages);
}

export async function summarize(state: AgentState, transcript: string, outputLimit?: number, abortSignal?: AbortSignal): Promise<string> {
  return summarizeWithinWindow(state, transcript, outputLimit, abortSignal);
}
