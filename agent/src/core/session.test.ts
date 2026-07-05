import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import { ChatSession } from './session.js';
import type { Asker, AskResult } from './types.js';

/** A fake Asker that records the prior-message array passed on each ask. */
function fakeAsker(answers: string[]): {
  asker: Asker;
  calls: ModelMessage[][];
} {
  const calls: ModelMessage[][] = [];
  let i = 0;
  const asker: Asker = {
    ask: async (_q, opts): Promise<AskResult> => {
      calls.push(opts?.messages ?? []);
      return { answer: answers[i++] ?? '', sources: [] };
    },
  };
  return { asker, calls };
}

describe('ChatSession', () => {
  it('threads prior turns into each ask and records the exchange', async () => {
    const { asker, calls } = fakeAsker(['first', 'second']);
    const session = new ChatSession({ agent: asker });

    await session.ask('what is auth?');
    await session.ask('tell me more');

    // First ask sees no prior turns; the second sees the first Q + A.
    expect(calls[0]).toEqual([]);
    expect(calls[1]).toEqual([
      { role: 'user', content: 'what is auth?' },
      { role: 'assistant', content: 'first' },
    ]);
    expect(session.history).toHaveLength(4);
    expect(session.history[3]?.content).toBe('second');
  });

  it('clear resets history and notifies subscribers', async () => {
    const { asker } = fakeAsker(['ok']);
    const session = new ChatSession({ agent: asker });
    await session.ask('one');

    let notified = false;
    session.subscribe(() => {
      notified = true;
    });
    session.clear();

    expect(session.history).toHaveLength(0);
    expect(notified).toBe(true);
  });
});
