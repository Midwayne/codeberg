import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';

import type { ContextSelection } from './selection.js';
import type { ContextSnapshot } from './snapshot.js';
import { CLEARED_PREFIX } from './clear.js';
import { lastUserIndex, toolResults, type ToolResultPart } from './plan.js';

/** Share of the ceiling past which older history is about to be summarized. */
export const SUMMARY_SOON = 0.9;

/** How full the context is: 0 below clearing, then earlier turns, the current turn, and near summary. */
export type ContextLevel = 0 | 1 | 2 | 3;

const NOTICES: Record<Exclude<ContextLevel, 0>, string> = {
  1: 'Large tool results from earlier turns are now being cleared.',
  2: 'Older tool results from this turn are now being cleared too. Keep the ones you still need with context_keep and release the rest with context_release.',
  3: 'Older messages will be summarized soon. Record findings you must not lose before then.',
};

/**
 * When usage crosses a higher level than the agent's previous request, the
 * text to tell it once. Only agents offered context_status get notes.
 */
export function contextNotice(
  request: LanguageModelV4CallOptions,
  level: ContextLevel,
  snapshot: Pick<ContextSnapshot, 'estimated' | 'ceiling'>,
  selection: ContextSelection,
): string | undefined {
  const previous = selection.level;
  selection.level = level;

  if (level === 0 || level <= previous) return undefined;
  if (!request.tools?.some((tool) => tool.name === 'context_status')) return undefined;

  const percent = Math.round((snapshot.estimated / snapshot.ceiling) * 100);

  return `<context_notice>Context is about ${percent}% of the working limit (${snapshot.estimated} of ${snapshot.ceiling} tokens). ${NOTICES[level]} Call context_status to see what remains.</context_notice>`;
}

/** Tool results `after` sends as cleared pointers that `before` sent in full, by turn. */
export function newlyCleared(before: LanguageModelV4CallOptions, after: LanguageModelV4CallOptions): { earlier: number; current: number } {
  const start = lastUserIndex(after.prompt);
  const was = toolResults(before.prompt).map(isCleared);
  const count = { earlier: 0, current: 0 };

  let index = 0;
  after.prompt.forEach((message, position) => {
    for (const part of toolResults([message])) {
      if (isCleared(part) && !was[index]) count[position < start ? 'earlier' : 'current']++;
      index++;
    }
  });

  return count;
}

function isCleared(part: ToolResultPart): boolean {
  return part.output.type === 'text' && part.output.value.startsWith(CLEARED_PREFIX);
}

/**
 * Append a notice at the very end of the request actually sent, after any
 * compaction. It is not part of the saved history, so later requests carry
 * only the conversation and keep their cached prefix.
 */
export function withNotice(request: LanguageModelV4CallOptions, notice: string | undefined): LanguageModelV4CallOptions {
  if (!notice) return request;

  return { ...request, prompt: [...request.prompt, { role: 'user', content: [{ type: 'text', text: notice }] }] };
}
