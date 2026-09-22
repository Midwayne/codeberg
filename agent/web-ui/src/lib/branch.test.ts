import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import { createChatBranch, isSessionSettled, messageIndexById } from './branch';

function user(id: string, text: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] };
}
function assistant(id: string, text: string): UIMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', text }] };
}

const messages: UIMessage[] = [
  user('u1', 'what is auth?'),
  assistant('a1', 'tokens'),
  user('u2', 'and refresh?'),
  assistant('a2', 'rotate them'),
];

describe('messageIndexById', () => {
  it('resolves a stored id and a role-index fallback', () => {
    expect(messageIndexById(messages, 'u2')).toBe(2);
    expect(messageIndexById([{ role: 'user' }, { role: 'assistant' }], 'user-0')).toBe(0);
    expect(messageIndexById(messages, 'nope')).toBe(-1);
  });
});

describe('createChatBranch', () => {
  it('copies a prefix, remaps ids, and titles the branch', () => {
    let n = 0;
    const branch = createChatBranch(messages, 0, 'parent', {
      newId: () => 'child',
      newMessageId: () => `b${n++}`,
    });

    expect(branch).toMatchObject({
      id: 'child',
      parentId: 'parent',
      title: 'what is auth? (branch)',
    });
    // User prompt snaps forward to include the assistant reply.
    expect(branch.messages.map((m) => m.parts)).toEqual([
      messages[0]!.parts,
      messages[1]!.parts,
    ]);
    expect(branch.messages.map((m) => m.id)).toEqual(['b0', 'b1']);
    expect(messages[0]!.id).toBe('u1');
  });

  it('copies the whole chat from the last message', () => {
    const branch = createChatBranch(messages, messages.length - 1, 'parent', {
      newId: () => 'all',
      newMessageId: () => 'x',
    });
    expect(branch.messages).toHaveLength(4);
    expect(branch.title).toBe('what is auth? (branch)');
  });
});

describe('isSessionSettled', () => {
  it('is ready when no adopt is in flight', () => {
    expect(isSessionSettled(null, 'a', [{ id: 'm1' }])).toBe(true);
  });

  it('waits until both the session id and last message match the adopt', () => {
    const pending = { id: 'child', lastId: 'b1' };
    expect(isSessionSettled(pending, 'parent', [{ id: 'b1' }])).toBe(false);
    expect(isSessionSettled(pending, 'child', [{ id: 'a2' }])).toBe(false);
    expect(isSessionSettled(pending, 'child', [{ id: 'u1' }, { id: 'b1' }])).toBe(true);
  });
});
