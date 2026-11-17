import { renderToStaticMarkup } from 'react-dom/server';
import type { UIMessage } from 'ai';
import { expect, it } from 'vitest';

import { WorkingStatus } from './working-status';

const question: UIMessage = { id: 'question', role: 'user', parts: [{ type: 'text', text: 'Where is chunking?' }] };

it('shows the cube loader while waiting and hides it once response text is visible', () => {
  const submitted = renderToStaticMarkup(<WorkingStatus status="submitted" messages={[]} />);
  const writing: UIMessage[] = [{ id: 'answer', role: 'assistant', parts: [{ type: 'text', text: 'Hello', state: 'streaming' }] }];

  expect(submitted).toContain('role="status"');
  expect(submitted).toContain('class="sr-only">Working…');
  expect(submitted).toContain('data-loader="cube"');
  expect(submitted.match(/class="loader-face"/g)).toHaveLength(6);
  expect(submitted).toContain('data-phase="waiting"');
  expect(submitted).toContain('Thinking…');

  const response = renderToStaticMarkup(<WorkingStatus status="streaming" messages={writing} />);

  expect(response).toBe('');
  expect(renderToStaticMarkup(<WorkingStatus status="ready" messages={writing} />)).toBe('');
});

it('starts each turn on a different waiting label', () => {
  const html = renderToStaticMarkup(<WorkingStatus status="submitted" messages={[question]} />);

  expect(html).toContain('Reading your question…');
});

it('names the running tool and keeps the loader while steering', () => {
  const messages: UIMessage[] = [question, { id: 'answer', role: 'assistant', parts: [
    { type: 'dynamic-tool', toolName: 'grep', toolCallId: 'search', state: 'input-available', input: {} },
  ] }];

  const streaming = renderToStaticMarkup(<WorkingStatus status="streaming" messages={messages} />);

  expect(streaming).toContain('data-phase="tool"');
  expect(streaming).toContain('Searching the code…');
  expect(renderToStaticMarkup(<WorkingStatus status="ready" messages={messages} steering />)).toContain('class="working-loader"');
});

it('shows the loader before the first text delta and again when a tool follows response text', () => {
  const messages: UIMessage[] = [{ id: 'answer', role: 'assistant', parts: [{ type: 'text', text: '', state: 'streaming' }] }];

  expect(renderToStaticMarkup(<WorkingStatus status="streaming" messages={messages} />)).toContain('class="working-loader"');

  messages[0]!.parts = [
    { type: 'text', text: 'Checking the source now.', state: 'done' },
    { type: 'dynamic-tool', toolName: 'read_file', toolCallId: 'read', state: 'input-available', input: {} },
  ];

  expect(renderToStaticMarkup(<WorkingStatus status="streaming" messages={messages} />)).toContain('Reading files…');
});

it('labels streamed reasoning', () => {
  const messages: UIMessage[] = [{ id: 'answer', role: 'assistant', parts: [
    { type: 'reasoning', text: 'Checking the source.', state: 'streaming' },
  ] }];

  const html = renderToStaticMarkup(<WorkingStatus status="streaming" messages={messages} />);

  expect(html).toContain('data-phase="reasoning"');
  expect(html).toContain('Reasoning…');
});

it('sweeps the label with a transform-driven shine overlay instead of repainting the text', () => {
  const html = renderToStaticMarkup(<WorkingStatus status="submitted" messages={[]} />);

  expect(html).toContain('class="working-label-text">Thinking…');
  expect(html).toContain('class="working-shine"><span class="working-shine-text">Thinking…');
});

it('keeps the loader through gaps after earlier response text while the turn is still streaming', () => {
  const intro = { type: 'text' as const, text: 'Checking the source now.', state: 'done' as const };
  const finishedTool = {
    type: 'dynamic-tool' as const, toolName: 'grep', toolCallId: 'search', state: 'output-available' as const, input: {}, output: 'hit',
  };

  const gaps: UIMessage['parts'][] = [
    [intro, finishedTool],
    [intro, { type: 'reasoning', text: 'Weighing the hits.', state: 'done' }],
    [intro, finishedTool, { type: 'step-start' }],
  ];

  for (const parts of gaps) {
    const messages: UIMessage[] = [question, { id: 'answer', role: 'assistant', parts }];

    expect(renderToStaticMarkup(<WorkingStatus status="streaming" messages={messages} />)).toContain('class="working-loader"');
  }
});

it('hides the loader again once new response text follows a tool', () => {
  const messages: UIMessage[] = [question, { id: 'answer', role: 'assistant', parts: [
    { type: 'dynamic-tool', toolName: 'grep', toolCallId: 'search', state: 'output-available', input: {}, output: 'hit' },
    { type: 'text', text: 'Chunking lives in core/src.', state: 'streaming' },
  ] }];

  expect(renderToStaticMarkup(<WorkingStatus status="streaming" messages={messages} />)).toBe('');
});
