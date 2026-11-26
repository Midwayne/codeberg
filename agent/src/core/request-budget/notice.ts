import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';

import type { ContextSelection } from './selection.js';
import type { ContextSnapshot } from './snapshot.js';

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
 * When usage crosses a higher level than the agent's previous request, tell
 * it once, at the end of this request. The note is not part of the saved
 * history, so later requests carry only the conversation and keep their
 * cached prefix. Only agents offered context_status get notes.
 */
export function withContextNotice(
  request: LanguageModelV4CallOptions,
  level: ContextLevel,
  snapshot: ContextSnapshot,
  selection: ContextSelection,
): LanguageModelV4CallOptions {
  const previous = selection.level;
  selection.level = level;

  if (level === 0 || level <= previous) return request;
  if (!request.tools?.some((tool) => tool.name === 'context_status')) return request;

  const percent = Math.round((snapshot.estimated / snapshot.ceiling) * 100);
  const text = `<context_notice>Context is about ${percent}% of the working limit (${snapshot.estimated} of ${snapshot.ceiling} tokens). ${NOTICES[level]} Call context_status to see what remains.</context_notice>`;

  return { ...request, prompt: [...request.prompt, { role: 'user', content: [{ type: 'text', text }] }] };
}
