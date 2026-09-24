import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';

import { Message } from './message';

describe('assistant activity group', () => {
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
