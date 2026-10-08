import { renderToStaticMarkup } from 'react-dom/server';
import type { UIMessage } from 'ai';
import { expect, it } from 'vitest';

import { WorkingStatus } from './working-status';

it('shows thinking while waiting and hides it once response text is visible', () => {
  const submitted = renderToStaticMarkup(<WorkingStatus status="submitted" messages={[]} />);
  const writing: UIMessage[] = [{ id: 'answer', role: 'assistant', parts: [{ type: 'text', text: 'Hello', state: 'streaming' }] }];

  expect(submitted).toContain('Thinking…');
  expect(submitted).toContain('role="status"');
  expect(submitted).toContain('class="thinking-label"');
  expect(submitted).toContain('class="sr-only">Thinking…');
  expect(submitted.match(/class="thinking-letter"/g)).toHaveLength(9);
  expect(submitted).not.toContain('<svg');
  const response = renderToStaticMarkup(<WorkingStatus status="streaming" messages={writing} />);

  expect(response).toBe('');
  expect(renderToStaticMarkup(<WorkingStatus status="ready" messages={writing} />)).toBe('');
});

it('keeps thinking as the only label during tools and steering', () => {
  const messages: UIMessage[] = [{ id: 'answer', role: 'assistant', parts: [
    { type: 'dynamic-tool', toolName: 'grep', toolCallId: 'search', state: 'input-available', input: {} },
  ] }];

  expect(renderToStaticMarkup(<WorkingStatus status="streaming" messages={messages} />)).toContain('Thinking…');
  expect(renderToStaticMarkup(<WorkingStatus status="ready" messages={messages} steering />)).toContain('Thinking…');
});

it('shows thinking before the first text delta and again when a tool follows response text', () => {
  const messages: UIMessage[] = [{ id: 'answer', role: 'assistant', parts: [{ type: 'text', text: '', state: 'streaming' }] }];

  expect(renderToStaticMarkup(<WorkingStatus status="streaming" messages={messages} />)).toContain('Thinking…');
  messages[0]!.parts = [
    { type: 'text', text: 'Checking the source now.', state: 'done' },
    { type: 'dynamic-tool', toolName: 'grep', toolCallId: 'search', state: 'input-available', input: {} },
  ];

  expect(renderToStaticMarkup(<WorkingStatus status="streaming" messages={messages} />)).toContain('Thinking…');
});

it('uses the thinking wave while the model streams reasoning', () => {
  const messages: UIMessage[] = [{ id: 'answer', role: 'assistant', parts: [
    { type: 'reasoning', text: 'Checking the source.', state: 'streaming' },
  ] }];

  expect(renderToStaticMarkup(<WorkingStatus status="streaming" messages={messages} />)).toContain('class="thinking-label"');
});
