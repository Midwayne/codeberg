import { expect, it } from 'vitest';

import { subagentSystem } from './prompt.js';

it('explains the shared working list to a subagent only when it has the worklist tools', () => {
  expect(subagentSystem('explorer', { worklist: true })).toContain('worklist_read');
  expect(subagentSystem('explorer')).not.toContain('worklist');
});
