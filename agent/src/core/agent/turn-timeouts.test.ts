import { expect, it } from 'vitest';

import { DEFAULT_TIMEOUT, SUBAGENT_TURN_TIMEOUT } from './options.js';
import { turnTimeouts } from './turn-timeouts.js';

it('keeps the default deadlines for ordinary turns', () => {
  expect(turnTimeouts(['grep', 'read_file'])).toEqual({ perCallTimeout: false, timeout: DEFAULT_TIMEOUT });
});

it('sizes subagent turns to their limits and still bounds each provider call', () => {
  expect(turnTimeouts(['grep', 'run_subagents'])).toEqual({ perCallTimeout: true, timeout: SUBAGENT_TURN_TIMEOUT });
  expect(SUBAGENT_TURN_TIMEOUT.stepMs).toBeGreaterThan(DEFAULT_TIMEOUT.stepMs);
});

it('lifts the run deadline for browser tasks but still bounds each provider call', () => {
  expect(turnTimeouts(['browser_task', 'run_subagents'])).toEqual({ perCallTimeout: true });
});
