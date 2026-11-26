import { jsonSchema, tool, type ToolSet } from 'ai';

import type { ToolSource } from '../tools/source.js';
import { keepResults, releaseResults } from './choices.js';
import { currentSelection, type ContextSelection } from './selection.js';

export const CONTEXT_CONTROL_TOOLS = ['context_status', 'context_keep', 'context_release'] as const;

/** Largest results context_status lists. */
const LISTED_RESULTS = 15;

/** System-prompt guidance added whenever context_status is offered. */
export const CONTEXT_CONTROL_INSTRUCTIONS = `

Context: older large tool results are cleared automatically as the context fills, earlier turns first. You may get a <context_notice> when usage crosses a threshold; it is not from the user. Call context_status to see usage, limits, and the largest results still in context with their ids. Use context_release on results you no longer need, such as searches that missed or files that proved irrelevant, so later steps cost less. Use context_keep sparingly, only for results you will keep working from across many more steps; it is capped. A cleared result is read back with context_read, not kept. Do not cut an investigation short because of context usage: clearing and summaries handle the limit.`;

type Ids = { ids: string[] };

export function contextControlToolSource(): ToolSource {
  return { name: 'context-control', tools: contextControlTools };
}

export function contextControlTools(): ToolSet {
  return {
    context_status: tool({
      description: 'Report your context window, the limit at which older history is summarized, the thresholds at which tool results are cleared, your last request\'s estimated size, and the largest tool results still in context with their ids, sizes, and whether you kept them. Results from calls in this step appear on the next step.',
      inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
      execute: async () => status(await currentSelection()),
    }),
    context_keep: tool({
      description: 'Keep tool results, by id from context_status, in full while they are in context, even when automatic clearing would replace them. Capped at 8 results and 15% of the working limit; release one to keep another. Only results still in full can be kept.',
      inputSchema: idsSchema,
      execute: async ({ ids }) => keepResults(await currentSelection(), ids),
    }),
    context_release: tool({
      description: 'Drop tool results, by id from context_status, that you no longer need. Each is replaced by a short note naming the file that holds its full text, from the next step on, which lowers the cost of every later step. Releasing a kept result un-keeps it. Results under 1,000 characters already cost less than the note.',
      inputSchema: idsSchema,
      execute: async ({ ids }) => releaseResults(await currentSelection(), ids),
    }),
  };
}

const idsSchema = jsonSchema<Ids>({
  type: 'object',
  properties: { ids: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, maxItems: 32 } },
  required: ['ids'],
  additionalProperties: false,
});

function status(selection: ContextSelection) {
  const snapshot = selection.snapshot;
  if (!snapshot) return { error: 'No model request has been measured yet in this chat.' };

  const inContext = snapshot.results.filter((result) => result.state !== 'cleared');
  const largest = [...inContext].sort((a, b) => b.tokens - a.tokens).slice(0, LISTED_RESULTS);
  const kept = inContext.filter((result) => result.kept);

  return {
    estimated: snapshot.estimated,
    percentOfLimit: Math.round((snapshot.estimated / snapshot.ceiling) * 100),
    limits: {
      window: snapshot.window,
      summarizeAt: snapshot.ceiling,
      clearEarlierTurnsAt: snapshot.clearEarlierAt,
      clearCurrentTurnAt: snapshot.clearCurrentAt,
    },
    summarized: snapshot.summarized,
    results: {
      total: snapshot.results.length,
      inContext: inContext.length,
      cleared: snapshot.results.length - inContext.length,
      kept: kept.length,
      keptTokens: kept.reduce((sum, result) => sum + result.tokens, 0),
      released: selection.release.size,
    },
    largest: largest.map(({ id, tool, input, tokens, turn, state, kept }) => ({ id, tool, input, tokens, turn, state, kept })),
  };
}
