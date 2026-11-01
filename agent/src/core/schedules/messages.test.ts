import { expect, it } from 'vitest';
import { isScheduledFollowUp, scheduledFollowUpMessage } from './messages.js';

it('identifies a persisted scheduled continuation without changing its model prompt', () => {
  const message = scheduledFollowUpMessage('wake-0', 'wake', 'Inspect the existing job and sleep again if needed.');
  const restored = JSON.parse(JSON.stringify(message));

  expect(isScheduledFollowUp(restored)).toBe(true);
  expect(restored).toMatchObject({ id: 'wake-0', role: 'user', parts: [
    { type: 'text', text: 'Inspect the existing job and sleep again if needed.' },
  ] });
});

it.each([undefined, null, [], 'scheduled-follow-up', {}, { codeberg: null },
  { codeberg: { kind: 'scheduled-follow-up' } },
  { codeberg: { kind: 'scheduled-follow-up', scheduleId: '' } },
  { codeberg: { kind: 'other', scheduleId: 'wake' } },
])('does not mistake an ordinary user message for a scheduled continuation: %j', (metadata) => {
  expect(isScheduledFollowUp({ role: 'user', metadata })).toBe(false);
});

it('does not treat assistant messages as scheduled prompts', () => {
  const message = scheduledFollowUpMessage('wake-0', 'wake', 'Check progress');

  expect(isScheduledFollowUp({ ...message, role: 'assistant' })).toBe(false);
});
