import { expect, it } from 'vitest';

import { subagentMaxSteps } from './config.js';

it('sets no subagent step budget unless CODEBERG_SUBAGENT_MAX_STEPS asks for one', () => {
  expect(subagentMaxSteps({})).toBeUndefined();
  expect(subagentMaxSteps({ CODEBERG_SUBAGENT_MAX_STEPS: '40' })).toBe(40);
  expect(subagentMaxSteps({ CODEBERG_SUBAGENT_MAX_STEPS: '1' })).toBeUndefined();
  expect(subagentMaxSteps({ CODEBERG_SUBAGENT_MAX_STEPS: 'lots' })).toBeUndefined();
});
