import { describe, expect, it } from 'vitest';

import { branchEndIndex, branchTitle, branchTranscript, cloneTranscript } from './branch.js';

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  nested?: { n: number };
}

function msg(id: string, role: Msg['role'], text: string): Msg {
  return { id, role, text, nested: { n: 1 } };
}

const transcript: Msg[] = [
  msg('u1', 'user', 'what is auth?'),
  msg('a1', 'assistant', 'tokens'),
  msg('u2', 'user', 'and refresh?'),
  msg('a2', 'assistant', 'rotate them'),
];

describe('cloneTranscript', () => {
  it('deep-clones so mutating the copy cannot touch the source', () => {
    const cloned = cloneTranscript(transcript);
    expect(cloned).toEqual(transcript);
    expect(cloned).not.toBe(transcript);
    cloned[0]!.nested!.n = 99;
    expect(transcript[0]!.nested!.n).toBe(1);
  });
});

describe('branchEndIndex', () => {
  it('returns -1 for an empty transcript', () => {
    expect(branchEndIndex([], 0)).toBe(-1);
  });

  it('clamps out-of-range indexes', () => {
    expect(branchEndIndex(transcript, -5)).toBe(1); // snaps user+assistant
    expect(branchEndIndex(transcript, 99)).toBe(3);
  });

  it('snaps a user prompt forward to include the following assistant reply', () => {
    expect(branchEndIndex(transcript, 0)).toBe(1);
    expect(branchEndIndex(transcript, 2)).toBe(3);
  });

  it('leaves an assistant index (or a trailing user prompt) as-is', () => {
    expect(branchEndIndex(transcript, 1)).toBe(1);
    expect(branchEndIndex(transcript, 3)).toBe(3);
    expect(branchEndIndex([msg('u', 'user', 'solo')], 0)).toBe(0);
  });
});

describe('branchTranscript', () => {
  it('defaults to copying the whole transcript', () => {
    expect(branchTranscript(transcript).map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('copies through a mid-chat assistant reply and leaves the source intact', () => {
    const branched = branchTranscript(transcript, { throughIndex: 1 });
    expect(branched.map((m) => m.id)).toEqual(['u1', 'a1']);
    expect(transcript).toHaveLength(4);
    branched[0]!.text = 'mutated';
    expect(transcript[0]!.text).toBe('what is auth?');
  });

  it('from a user prompt includes the following assistant turn', () => {
    const branched = branchTranscript(transcript, { throughIndex: 2 });
    expect(branched.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('returns empty for an empty source', () => {
    expect(branchTranscript([])).toEqual([]);
  });

  it('applies remap to the clone only', () => {
    const branched = branchTranscript(transcript, {
      throughIndex: 1,
      remap: (m) => ({ ...m, id: `b-${m.id}` }),
    });
    expect(branched.map((m) => m.id)).toEqual(['b-u1', 'b-a1']);
    expect(transcript[0]!.id).toBe('u1');
  });
});

describe('branchTitle', () => {
  it('appends a suffix, skipping blanks and not stacking', () => {
    expect(branchTitle('jwt auth bug')).toBe('jwt auth bug (branch)');
    expect(branchTitle('jwt auth bug (branch)')).toBe('jwt auth bug (branch)');
    expect(branchTitle('  ')).toBe('New chat (branch)');
    expect(branchTitle('', '(untitled)')).toBe('(untitled) (branch)');
  });
});
