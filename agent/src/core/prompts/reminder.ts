import type { ModelMessage } from 'ai';

import type { ModelProfile } from '../../providers/profiles.js';

/** The rules small models drop first once the transcript grows long. */
export const TIER_REMINDER = [
  '<reminder>',
  'Answer only from code you retrieved in this conversation. Cite every code claim as [path:start-end].',
  'Put independent tool calls in one response. Keep searching until you can cite the answer.',
  'If evidence is missing, say what you found and what you could not verify. Do not guess.',
  '</reminder>',
].join('\n');

type UserContent = Exclude<Extract<ModelMessage, { role: 'user' }>['content'], string>;

/**
 * For `light` models, repeat the key rules after each user message so they
 * sit close to the question, not only at the top of a long system prompt.
 * Every user message gets the same reminder, so a turn already sent stays
 * byte-identical when the next one arrives and the prompt cache still
 * matches. A message that already carries it is left as is, since prepared
 * messages carry into the next tool step.
 */
export function withTierReminder(messages: ModelMessage[], profile: ModelProfile): ModelMessage[] {
  if (profile.tier !== 'light') return messages;

  let changed = false;
  const next = messages.map((message) => {
    if (message.role !== 'user') return message;

    const reminded = withReminder(message);
    if (reminded !== message) changed = true;

    return reminded;
  });

  return changed ? next : messages;
}

function withReminder(message: Extract<ModelMessage, { role: 'user' }>): ModelMessage {
  const parts: UserContent = typeof message.content === 'string'
    ? [{ type: 'text', text: message.content }]
    : message.content;

  if (parts.some((part) => part.type === 'text' && part.text === TIER_REMINDER)) return message;

  return { ...message, content: [...parts, { type: 'text', text: TIER_REMINDER }] };
}
