import { describe, expect, it } from 'vitest';

import { Semaphore } from '../semaphore.js';
import { MAX_SUBAGENTS, SubagentStore } from './store.js';

describe('Semaphore', () => {
  it('never runs more than its limit at once', async () => {
    const gate = new Semaphore(2);
    let running = 0;
    let peak = 0;

    const work = () => gate.run(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
    });

    await Promise.all(Array.from({ length: 6 }, work));

    expect(peak).toBe(2);
  });
});

describe('SubagentStore', () => {
  it('drops the least recently used session past its capacity', () => {
    const store = new SubagentStore(2);
    const a = store.create('explorer', 'a');
    const b = store.create('worker', 'b');
    store.get(a.id);
    const c = store.create('explorer', 'c');

    expect(store.get(b.id)).toBeUndefined();
    expect(store.get(a.id)?.description).toBe('a');
    expect(store.get(c.id)?.type).toBe('explorer');
  });

  it('never drops a running session to make room', () => {
    const store = new SubagentStore(2);
    const running = store.create('explorer', 'running');
    running.busy = true;
    const idle = store.create('explorer', 'idle');
    store.create('explorer', 'newest');

    expect(store.get(running.id)).toBe(running);
    expect(store.get(idle.id)).toBeUndefined();
  });

  it('keeps every session from two parallel calls that each start the most subagents allowed', () => {
    const store = new SubagentStore();
    const sessions = Array.from({ length: 2 * MAX_SUBAGENTS }, (_, index) => store.create('explorer', `task ${index}`));

    expect(sessions.every(({ id }) => store.get(id))).toBe(true);
  });

  it('keeps every session from a call that starts the most subagents allowed', () => {
    const store = new SubagentStore();
    const sessions = Array.from({ length: MAX_SUBAGENTS }, (_, index) => store.create('explorer', `task ${index}`));

    expect(sessions.every(({ id }) => store.get(id))).toBe(true);
  });
});
