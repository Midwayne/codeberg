import { tool, type ToolSet } from 'ai';
import { executeDecision, type DecisionToolDependencies } from './execute.js';
import { decisionSchema } from './schema.js';
import type { DecisionModel } from './types.js';

export function decisionTools(model: DecisionModel | null, deps: DecisionToolDependencies = {}): ToolSet {
  if (!model) return {};

  return {
    decide: tool({
      description: 'Ask a fast decisions API for bounded judgments at any point. ' +
        'Use files to send candidate paths/ranges directly to the decisions model before reading them yourself. ' +
        'Omit questions with files for automatic per-file relevance probabilities; no need to write a question per file. ' +
        'Only compact probabilities and file metadata return; source bodies stay out of your context. ' +
        'Batch independent relevance predicates/scores per candidate when several files may matter; ' +
        'use choice to select one next action, with an other/none option when needed. ' +
        'Also check evidence sufficiency, compare hypotheses, prioritize tests, or decide whether to search deeper. ' +
        'Use search snippets first when sufficient; avoid sending the full conversation or repeating decisions. ' +
        'Skip trivial judgments and do not use it for prose, tool arguments, or hard reasoning. ' +
        'Probabilities are estimates, not proof; retain uncertain candidates and verify conclusions with source reads.',
      inputSchema: decisionSchema,
      execute: (input, options) => executeDecision(model, input, { ...deps, signal: options.abortSignal }),
    }),
  };
}
