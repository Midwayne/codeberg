import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';

import { Message } from './message';

describe('assistant tool-call group', () => {
  it('wraps every tool call in one disclosure while keeping their individual disclosures', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'First' },
        { type: 'dynamic-tool', toolCallId: 'a', toolName: 'grep', state: 'output-available', input: { pattern: 'x' }, output: [] },
        { type: 'text', text: 'Last' },
        { type: 'dynamic-tool', toolCallId: 'b', toolName: 'glob', state: 'output-available', input: { pattern: '*' }, output: [] },
      ],
    } as UIMessage;

    const html = renderToStaticMarkup(<Message message={message} />);
    expect(html).toContain('2 tool calls');
    expect(html.match(/<details/g)).toHaveLength(3); // group + both original tool disclosures
    expect(html.indexOf('First')).toBeLessThan(html.indexOf('2 tool calls'));
    expect(html.indexOf('2 tool calls')).toBeLessThan(html.indexOf('0 grep match'));
    expect(html.indexOf('0 glob results')).toBeLessThan(html.indexOf('Last'));
  });

  it('does not add an empty group to text-only or user messages', () => {
    for (const role of ['assistant', 'user'] as const) {
      const message = { id: role, role, parts: [{ type: 'text', text: 'Hello' }] } as UIMessage;
      expect(renderToStaticMarkup(<Message message={message} />)).not.toContain('tool calls');
    }
  });
});
