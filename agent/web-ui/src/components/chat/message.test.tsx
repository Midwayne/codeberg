import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';

import { Message } from './message';

it('shows scheduled continuations as neutral markers with collapsed task details and no user actions', () => {
  const message: UIMessage = {
    id: 'wake-0', role: 'user', metadata: { codeberg: { kind: 'scheduled-follow-up', scheduleId: 'wake' } },
    parts: [{ type: 'text', text: 'Inspect the existing background scan. Do not start it again.' }],
  };
  const html = renderToStaticMarkup(<Message message={message} onBranch={() => undefined} />);

  expect(html).toContain('Resuming scheduled task…');
  expect(html).toContain('data-message-id="wake-0"');
  expect(html).toMatch(/<details[^>]*>\s*<summary[^>]*>Task details<\/summary>/);
  expect(html).toContain(message.parts[0]!.type === 'text' ? message.parts[0]!.text : '');
  expect(html).not.toMatch(/<details[^>]*\bopen(?:=|\s|>)/);
  expect(html).not.toContain('bg-muted');
  expect(html).not.toContain('items-end');
  expect(html).not.toContain('Branch from here');
});

it('keeps human-authored messages as user bubbles even when they mention resuming', () => {
  const message: UIMessage = { id: 'human', role: 'user', parts: [{ type: 'text', text: 'Resuming scheduled task…' }] };
  const html = renderToStaticMarkup(<Message message={message} onBranch={() => undefined} />);

  expect(html).toContain('bg-muted');
  expect(html).toContain('items-end');
  expect(html).toContain('Branch from here');
  expect(html).not.toContain('Task details');
});

it('wraps unbroken user text inside its bubble while preserving the full text and newlines', () => {
  const token = 'a'.repeat(2000);
  const text = `Payload:\n${token}\nhttps://example.com/${token}`;
  const message: UIMessage = { id: 'long-prompt', role: 'user', parts: [{ type: 'text', text }] };

  const html = renderToStaticMarkup(<Message message={message} />);

  expect(html).toContain(text);
  expect(html).toMatch(/class="[^"]*whitespace-pre-wrap[^"]*\[overflow-wrap:anywhere\][^"]*"/);
  expect(html).not.toContain('truncate');
});

describe('assistant activity group', () => {
  it('shows multimodal user attachments alongside text without exposing encoded bytes', () => {
    const message = { id: 'u', role: 'user', parts: [
      { type: 'text', text: 'Inspect this' },
      { type: 'file', filename: 'picture.png', mediaType: 'image/png', url: 'data:image/png;base64,AQID' },
      { type: 'file', filename: 'report.pdf', mediaType: 'application/pdf', url: 'data:application/pdf;base64,AQID' },
    ] } as UIMessage;
    const html = renderToStaticMarkup(<Message message={message} />);
    expect(html).toContain('Inspect this');
    expect(html).toContain('alt="picture.png"');
    expect(html).toContain('report.pdf');
    expect(html).not.toContain('data:application/pdf;base64,AQID');
  });
  it('uses a compact feedback dropdown with full wording only when learning is enabled', () => {
    const message = { id: 'answer', role: 'assistant', parts: [{ type: 'text', text: 'Done.' }] } as UIMessage;
    const html = renderToStaticMarkup(<Message message={message} conversationId="chat" learningEnabled />);
    expect(html).toContain('aria-label="Rate this answer"');
    expect(html).toContain('<select');
    expect(html).toMatch(/<option value="not_useful"[^>]*>Not useful<\/option>/);
    expect(html).toMatch(/<option value="partially_useful"[^>]*>Partially useful<\/option>/);
    expect(html).toMatch(/<option value="mostly_correct"[^>]*>Mostly correct<\/option>/);
    expect(html).toMatch(/<option value="solved"[^>]*>Solved<\/option>/);
    expect(html).not.toContain('Updating knowledge base');
    expect(renderToStaticMarkup(<Message message={message} conversationId="chat" learningEnabled={false} />)).not.toContain('Rate this answer');
  });
  it('uses a borderless rating control with themed menu options and visible focus', () => {
    const message = { id: 'answer', role: 'assistant', parts: [{ type: 'text', text: 'Done.' }] } as UIMessage;
    const html = renderToStaticMarkup(<Message message={message} conversationId="chat" learningEnabled />);
    const control = html.match(/<select\b[^>]*>/)?.[0];
    expect(control).toContain('appearance-none');
    expect(control).toContain('border-0');
    expect(control).toContain('bg-transparent');
    expect(control).not.toContain('hover:border');
    expect(control).toContain('hover:text-accent-foreground');
    expect(control).toContain('focus-visible:text-accent-foreground');
    expect(html).toContain('bg-popover text-popover-foreground');
  });
  it('wraps reasoning and tools in one disclosure while keeping their individual disclosures', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'First' },
        { type: 'reasoning', text: 'Thinking first' },
        { type: 'dynamic-tool', toolCallId: 'a', toolName: 'grep', state: 'output-available', input: { pattern: 'x' }, output: [] },
        { type: 'text', text: 'Last' },
        { type: 'reasoning', text: 'Thinking again' },
        { type: 'dynamic-tool', toolCallId: 'b', toolName: 'glob', state: 'output-available', input: { pattern: '*' }, output: [] },
      ],
    } as UIMessage;

    const html = renderToStaticMarkup(<Message message={message} />);
    expect(html).toContain('2 tool calls · 2 reasoning traces');
    expect(html.match(/<details/g)).toHaveLength(5); // group + tools + reasoning panels
    expect(html.indexOf('First')).toBeLessThan(html.indexOf('2 tool calls'));
    expect(html.indexOf('2 tool calls')).toBeLessThan(html.indexOf('Thinking first'));
    expect(html.indexOf('Thinking first')).toBeLessThan(html.indexOf('0 grep match'));
    expect(html.indexOf('0 grep match')).toBeLessThan(html.indexOf('Thinking again'));
    expect(html.indexOf('Thinking again')).toBeLessThan(html.indexOf('0 glob results'));
    expect(html.indexOf('0 glob results')).toBeLessThan(html.indexOf('Last'));
  });

  it('groups reasoning even when no tools were called', () => {
    const message = { id: 'thinking', role: 'assistant', parts: [
      { type: 'reasoning', text: 'Step one' },
      { type: 'reasoning', text: 'Step two' },
    ] } as UIMessage;
    const html = renderToStaticMarkup(<Message message={message} />);
    expect(html).toContain('2 reasoning traces');
    expect(html.match(/<details/g)).toHaveLength(3);
  });

  it('does not add an empty group to text-only or user messages', () => {
    for (const role of ['assistant', 'user'] as const) {
      const message = { id: role, role, parts: [{ type: 'text', text: 'Hello' }] } as UIMessage;
      expect(renderToStaticMarkup(<Message message={message} />)).not.toContain('<details');
    }
  });
});
