import { describe, expect, it } from 'vitest';

import { messageText, messageTranscript, toolResultOutputText } from './message.js';

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

  it('renders tool-result text and file content parts', () => {
    expect(
      toolResultOutputText({
        type: 'content',
        value: [
          { type: 'text', text: 'hello' },
          { type: 'file-url', url: 'https://example.com/a.png' },
        ],
      }),
    ).toBe('hello\n[file]');
    expect(toolResultOutputText({ type: 'execution-denied', reason: 'no' })).toBe('no');
    expect(toolResultOutputText({ type: 'execution-denied' })).toBe('execution denied');
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
