import { describe, expect, it } from 'vitest';

import { SUBAGENT_INSTRUCTIONS, subagentSystem } from './prompt.js';

describe('SUBAGENT_INSTRUCTIONS', () => {
  it('asks the main agent for a clear goal and specific steps when they are known', () => {
    expect(SUBAGENT_INSTRUCTIONS).toMatch(/Goal:.*what "done" looks like/);

    expect(SUBAGENT_INSTRUCTIONS).toMatch(/Steps: when you already know how to do it, give numbered, specific steps/);

    expect(SUBAGENT_INSTRUCTIONS).toMatch(/When you do not, say the approach is open/);
  });

  it('keeps the brief parts in goal, context, steps, return order', () => {
    const order = ['1. Goal:', '2. Context:', '3. Steps:', '4. Return:'].map((part) => SUBAGENT_INSTRUCTIONS.indexOf(part));

    expect(order.every((index) => index >= 0)).toBe(true);

    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('subagentSystem', () => {
  it('tells both subagent types to follow given steps toward the goal', () => {
    for (const type of ['explorer', 'worker'] as const) {
      expect(subagentSystem(type)).toMatch(/When the brief gives numbered steps, follow them in order/);
    }
  });
});
