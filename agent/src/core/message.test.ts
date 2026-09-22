import { describe, expect, it } from 'vitest';

import { messageText, messageTranscript } from './message.js';

describe('messageText', () => {
  it('returns string content as-is', () => {
    expect(messageText({ role: 'user', content: 'hi' })).toBe('hi');
  });

  it('includes tool calls and tool results in the transcript', () => {
    expect(
      messageTranscript({
        role: 'assistant',
        content: [
          { type: 'text', text: 'looking' },
          { type: 'tool-call', toolCallId: '1', toolName: 'grep', input: { pattern: 'foo' } },
        ],
      }),
    ).toContain('tool-call grep');
    expect(
      messageTranscript({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: '1',
            toolName: 'grep',
            output: { type: 'text', value: 'core/src/foo.c:10' },
          },
        ],
      }),
    ).toContain('core/src/foo.c:10');
  });

  it('concatenates text parts and ignores non-text parts', () => {
    expect(
      messageText({
        role: 'assistant',
        content: [
          { type: 'text', text: 'a' },
          { type: 'tool-call', toolCallId: '1', toolName: 'x', input: {} },
          { type: 'text', text: 'b' },
        ],
      }),
    ).toBe('ab');
  });
});
