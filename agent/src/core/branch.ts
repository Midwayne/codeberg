/**
 * Fork a chat transcript: copy a prefix into a new array so the branch can
 * diverge without sharing objects or mutating the source.
 *
 * Message-shape agnostic — TUI `ModelMessage`s, web `UIMessage`s, and
 * `ChatSession` turns all go through the same helpers. Surfaces that need a
 * fresh id (the browser chat) pass `remap`.
 */

export interface BranchOptions<T> {
  /** Inclusive index to copy through. Defaults to the last message. */
  throughIndex?: number;
  /** Applied to each cloned message (e.g. assign a fresh id). */
  remap?: (message: T) => T;
}

/** Deep-clone a transcript so the branch owns its own objects. */
export function cloneTranscript<T>(messages: readonly T[]): T[] {
  return structuredClone(messages) as T[];
}

/**
 * Inclusive end index for a branch. Out-of-range values clamp into the
 * transcript; a user prompt followed by an assistant reply snaps forward so
 * the copy is a complete turn rather than a dangling question.
 */
export function branchEndIndex<T extends { role: string }>(
  messages: readonly T[],
  throughIndex: number,
): number {
  if (messages.length === 0) {
    return -1;
  }
  let i = Math.min(Math.max(Math.trunc(throughIndex), 0), messages.length - 1);
  if (!Number.isFinite(i)) {
    i = messages.length - 1;
  }
  if (messages[i]?.role === 'user' && messages[i + 1]?.role === 'assistant') {
    return i + 1;
  }
  return i;
}

/**
 * A cloned prefix of `messages` that seeds a new chat. The source array and
 * its items are left untouched.
 */
export function branchTranscript<T extends { role: string }>(
  messages: readonly T[],
  opts: BranchOptions<T> = {},
): T[] {
  if (messages.length === 0) {
    return [];
  }
  const last = messages.length - 1;
  const requested = opts.throughIndex ?? last;
  const end = branchEndIndex(messages, requested);
  if (end < 0) {
    return [];
  }
  const cloned = cloneTranscript(messages.slice(0, end + 1));
  return opts.remap ? cloned.map(opts.remap) : cloned;
}

const BRANCH_SUFFIX = ' (branch)';

/** Title for a branched session, without stacking the suffix. */
export function branchTitle(sourceTitle: string, empty = 'New chat'): string {
  const clean = sourceTitle.replace(/\s+/g, ' ').trim();
  const base = clean || empty;
  return base.endsWith(BRANCH_SUFFIX) ? base : `${base}${BRANCH_SUFFIX}`;
}
