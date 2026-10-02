import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';

import { MessageList } from './message-list';

const messages: UIMessage[] = [
  { id: 'q', role: 'user', parts: [{ type: 'text', text: 'Where does the request go?' }] },
  { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'Through the daemon.' }] },
];

function render(busy: boolean): string {
  return renderToStaticMarkup(<MessageList messages={messages} sessionId="saved" learningEnabled={false} busy={busy} onRegenerate={() => {}} onBranch={() => {}} />);
}

describe('conversation transcript', () => {
  it('preserves message anchors and offers regeneration only on the final answer', () => {
    const html = render(false);
    expect(html).toContain('data-message-id="q"');
    expect(html).toContain('data-message-id="a"');
    expect(html.match(/aria-label="Regenerate"/g)).toHaveLength(1);
    expect(html.match(/aria-label="Branch from here"/g)).toHaveLength(2);
  });

  it('keeps content visible while disabling branch and regeneration during streaming', () => {
    const html = render(true);
    expect(html).toContain('Through the daemon.');
    expect(html).not.toContain('aria-label="Regenerate"');
    expect(html).not.toContain('aria-label="Branch from here"');
  });
});
