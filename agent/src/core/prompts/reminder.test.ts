import type { ModelMessage } from 'ai';
import { expect, it } from 'vitest';

import { DEFAULT_PROFILE } from '../../providers/profiles.js';
import { TIER_REMINDER, withTierReminder } from './reminder.js';

const light = { ...DEFAULT_PROFILE, tier: 'light' as const };

const conversation: ModelMessage[] = [
  { role: 'user', content: 'first question' },
  { role: 'assistant', content: 'first answer' },
  { role: 'user', content: 'where is chunking?' },
  { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'a', toolName: 'grep', input: {} }] },
  { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'a', toolName: 'grep', output: { type: 'text', value: 'hit' } }] },
];

const reminded = (text: string) => ({ role: 'user', content: [{ type: 'text', text }, { type: 'text', text: TIER_REMINDER }] });

it('adds the reminder to every user message for light models', () => {
  const next = withTierReminder(conversation, light);

  expect(next[0]).toEqual(reminded('first question'));
  expect(next[2]).toEqual(reminded('where is chunking?'));
  expect(next[1]).toBe(conversation[1]);
  expect(next.slice(3)).toEqual(conversation.slice(3));
});

it('keeps earlier turns byte-identical when the next turn arrives', () => {
  const firstTurn = withTierReminder(conversation.slice(0, 1), light);
  const secondTurn = withTierReminder(conversation.slice(0, 3), light);

  expect(secondTurn[0]).toEqual(firstTurn[0]);
});

it('adds the reminder only once across tool steps', () => {
  const once = withTierReminder(conversation, light);

  expect(withTierReminder(once, light)).toBe(once);
});

it('appends to array content without dropping attachments', () => {
  const image: ModelMessage = { role: 'user', content: [{ type: 'text', text: 'what is this?' }, { type: 'image', image: 'data:image/png;base64,AA==' }] };
  const [next] = withTierReminder([image], light);

  expect(next!.content).toEqual([...(image.content as unknown[]), { type: 'text', text: TIER_REMINDER }]);
});

it('leaves standard models and conversations without a user message alone', () => {
  expect(withTierReminder(conversation, { ...DEFAULT_PROFILE, tier: 'standard' })).toBe(conversation);

  const none: ModelMessage[] = [{ role: 'assistant', content: 'hi' }];
  expect(withTierReminder(none, light)).toBe(none);
});
