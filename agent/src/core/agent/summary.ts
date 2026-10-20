import { budgetWindow, historyBudget } from '../../providers/profiles.js';
import { IncompleteSummaryError, isContextOverflow } from '../context-errors.js';
import { boundTranscript, estimateTokens, SUMMARY_INPUT_CHARS } from '../history.js';
import { HISTORY_SUMMARY_SYSTEM } from '../prompts/history-summary.js';
import type { AgentState } from './state.js';

export async function summarizeWithinWindow(state: AgentState, transcript: string, outputLimit = 2000, abortSignal?: AbortSignal): Promise<string> {
  const window = budgetWindow(state.summaryProfile);
  const maxOutputTokens = Math.max(1, Math.min(outputLimit, 2000, Math.floor(historyBudget(state.profile) * 0.25), Math.floor(window * 0.15)));
  const input = Math.floor(window * 0.85) - maxOutputTokens - estimateTokens(HISTORY_SUMMARY_SYSTEM) - 32;
  if (input <= 0) throw new IncompleteSummaryError();

  const cap = Math.min(SUMMARY_INPUT_CHARS, input * 4);
  const targets = [1, 0.7, 0.5, 0.35];

  for (let attempt = 0; attempt < targets.length; attempt++) {
    abortSignal?.throwIfAborted();

    try {
      const summary = await state.generator.generate({
        system: HISTORY_SUMMARY_SYSTEM,
        prompt: boundTranscript(transcript, Math.floor(cap * targets[attempt]!)),
        maxOutputTokens,
        requireComplete: true,
        ...(abortSignal ? { abortSignal } : {}),
      });
      if (!summary.trim()) throw new IncompleteSummaryError();

      return summary;
    } catch (error) {
      if (!isContextOverflow(error) || attempt === targets.length - 1) throw error;
    }
  }

  throw new IncompleteSummaryError();
}
