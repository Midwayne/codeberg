import { MIN_CLEAR_CHARS } from './clear.js';
import type { ContextSelection } from './selection.js';
import type { ResultInfo } from './snapshot.js';

/** Most results one agent can keep at a time. */
export const MAX_KEPT_RESULTS = 8;

/** Most of the working limit kept results can fill. */
export const MAX_KEPT_SHARE = 0.15;

/** Released ids remembered per agent; the oldest are forgotten first. */
const MAX_RELEASED = 2_000;

type Refusal = { id: string; reason: string };

/**
 * Keep results in full. Only results the last request carried in full can be
 * kept: keeping a cleared one would rewrite an earlier part of the prompt and
 * lose the provider's prompt cache from there, so it is read again instead.
 */
export async function keepResults(selection: ContextSelection, ids: readonly string[]) {
  const results = resultsById(selection);
  const ceiling = selection.snapshot?.ceiling ?? 0;
  const maxTokens = Math.floor(ceiling * MAX_KEPT_SHARE);

  const kept: string[] = [];
  const refused: Refusal[] = [];

  for (const id of new Set(ids)) {
    const reason = keepRefusal(selection, results, id, maxTokens);
    if (reason) {
      refused.push({ id, reason });
      continue;
    }

    selection.keep.add(id);
    kept.push(id);
  }

  if (kept.length > 0) await selection.save();

  return { kept, refused, keptResults: selection.keep.size, keptTokens: keptTokens(selection, results), maxResults: MAX_KEPT_RESULTS, maxTokens };
}

function keepRefusal(selection: ContextSelection, results: Map<string, ResultInfo>, id: string, maxTokens: number): string | undefined {
  const result = results.get(id);
  if (!result) return 'Unknown id. Use an id from context_status; results of this step appear on the next one.';
  if (selection.keep.has(id)) return undefined;
  if (selection.release.has(id) || result.state === 'cleared') return 'Already cleared. Read it again with context_read if you need it.';
  if (selection.keep.size >= MAX_KEPT_RESULTS) return `At most ${MAX_KEPT_RESULTS} results can be kept. Release one first.`;
  if (keptTokens(selection, results) + result.tokens > maxTokens) return `Kept results would pass ${maxTokens} tokens. Release one first.`;

  return undefined;
}

/** Kept ids the last request no longer carried (summarized away) hold no slot. */
export function pruneKept(selection: ContextSelection): boolean {
  const present = new Set((selection.snapshot?.results ?? []).map((result) => result.id));
  const gone = [...selection.keep].filter((id) => !present.has(id));

  for (const id of gone) selection.keep.delete(id);

  return gone.length > 0;
}

/** Release results: they are cleared from the next request on and stay cleared. */
export async function releaseResults(selection: ContextSelection, ids: readonly string[]) {
  const results = resultsById(selection);

  const released: string[] = [];
  const refused: Refusal[] = [];

  for (const id of new Set(ids)) {
    // Un-keep first: a kept result that has left the prompt must still free its slot.
    const wasKept = selection.keep.delete(id);
    const result = results.get(id);
    if (!result) {
      if (wasKept) released.push(id);
      else refused.push({ id, reason: 'Unknown id. Use an id from context_status; results of this step appear on the next one.' });
      continue;
    }

    // Already cleared: its note is short, but releasing keeps it cleared.
    if (result.state === 'cleared') {
      remember(selection.release, id);
      released.push(id);
      continue;
    }

    if (result.chars < MIN_CLEAR_CHARS) {
      refused.push({ id, reason: `Under ${MIN_CLEAR_CHARS} characters; it already costs less than the note that would replace it.` });
      continue;
    }

    remember(selection.release, id);
    released.push(id);
  }

  await selection.save();

  const freed = released.map((id) => results.get(id)).filter((result) => result !== undefined && result.state !== 'cleared');

  return { released, refused, freedTokens: freed.reduce((sum, result) => sum + result!.tokens, 0) };
}

function resultsById(selection: ContextSelection): Map<string, ResultInfo> {
  return new Map((selection.snapshot?.results ?? []).map((result) => [result.id, result]));
}

function keptTokens(selection: ContextSelection, results: Map<string, ResultInfo>): number {
  return [...selection.keep].reduce((sum, id) => sum + (results.get(id)?.tokens ?? 0), 0);
}

function remember(released: Set<string>, id: string): void {
  released.delete(id);
  released.add(id);

  for (const oldest of released) {
    if (released.size <= MAX_RELEASED) break;

    released.delete(oldest);
  }
}
