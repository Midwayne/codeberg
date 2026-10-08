import type { UIMessage } from 'ai';
import { expect, it } from 'vitest';

import { interruptedMessages } from './interrupted-messages';

it('settles partial text and tool activity while preserving completed results', () => {
  const messages: UIMessage[] = [{ id: 'answer', role: 'assistant', parts: [
    { type: 'text', text: 'Partial answer', state: 'streaming' },
    { type: 'dynamic-tool', toolName: 'grep', toolCallId: 'partial', state: 'input-streaming', input: undefined },
    { type: 'dynamic-tool', toolName: 'grep', toolCallId: 'running', state: 'input-available', input: { pattern: 'work' } },
    { type: 'dynamic-tool', toolName: 'grep', toolCallId: 'done', state: 'output-available', input: {}, output: [] },
  ] }];

  const next = interruptedMessages(messages);

  expect(next[0]!.parts).toEqual([
    { type: 'text', text: 'Partial answer', state: 'done' },
    { type: 'dynamic-tool', toolName: 'grep', toolCallId: 'running', state: 'output-error', input: { pattern: 'work' }, errorText: 'Stopped by user.' },
    messages[0]!.parts[3],
  ]);
  expect(messages[0]!.parts).toHaveLength(4);
});

it('drops an empty assistant shell when stopped before any usable output arrives', () => {
  expect(interruptedMessages([{ id: 'shell', role: 'assistant', parts: [
    { type: 'dynamic-tool', toolName: 'grep', toolCallId: 'partial', state: 'input-streaming', input: undefined },
  ] }])).toEqual([]);
});
