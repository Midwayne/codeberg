import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';

import { messageSearchHits } from './session-search.js';

describe('messageSearchHits', () => {
  it('returns message ids and compact text excerpts, excluding tool payloads', () => {
    const messages = [
      { id: 'q', role: 'user', parts: [{ type: 'text', text: 'How do we refresh tokens?' }] },
      { id: 'a', role: 'assistant', parts: [
        { type: 'text', text: 'Tokens refresh automatically.' },
        { type: 'dynamic-tool', toolName: 'lookup', state: 'output-available', toolCallId: 't', input: {}, output: 'secret token' },
      ] },
    ] as UIMessage[];
    expect(messageSearchHits(messages, 'TOKENS')).toEqual([
      { messageId: 'q', role: 'user', snippet: 'How do we refresh tokens?' },
      { messageId: 'a', role: 'assistant', snippet: 'Tokens refresh automatically.' },
    ]);
    expect(messageSearchHits(messages, 'secret')).toEqual([]);
  });
});
