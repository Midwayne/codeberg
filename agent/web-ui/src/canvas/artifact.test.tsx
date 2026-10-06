import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { canvasAnchor } from './conversation';
import { MessageList } from '../components/chat/message-list';
import { ProjectApiContext } from '../lib/project-api';

function transcript(messages: UIMessage[], sessionId = 'current-chat') {
  return renderToStaticMarkup(
    <ProjectApiContext.Provider value={{ project: { id: 'demo', name: 'Demo', roots: [] }, fetch, ready: true }}>
      <MessageList messages={messages} sessionId={sessionId} learningEnabled={false} busy={false} onRegenerate={() => {}} />
    </ProjectApiContext.Provider>,
  );
}

const drawing = (id: string, tool = 'canvas_add'): UIMessage => ({ id, role: 'assistant', parts: [
  { type: 'dynamic-tool', toolName: tool, toolCallId: id, state: 'output-available', input: {},
    output: { kind: 'canvas', chatId: 'parent-chat', url: 'https://untrusted.example/canvas', revision: 1 } },
  { type: 'text', text: 'Here is the request flow.' },
] });

it('shows one inline canvas automatically, outside collapsed activity, scoped to the current chat', () => {
  const messages = [drawing('first'), drawing('edit', 'canvas_update')];
  expect(canvasAnchor(messages)).toBe('edit');
  const html = transcript(messages);
  expect(html.match(/<iframe/g)).toHaveLength(1);
  expect(html).toContain('title="Chat canvas"');
  expect(html).toContain('/canvas?chat=current-chat&amp;project=demo&amp;embedded=1');
  expect(html).toContain('aria-label="Expand canvas"');
  expect(html).not.toContain('untrusted.example');
  expect(html).not.toContain('parent-chat');
  expect(html).not.toContain('tool call');
  expect(html).not.toContain('canvas_add');
  expect(html).not.toContain('Show canvas');
  expect(html).not.toContain('<select');
});

it('leaves unused chats alone and keeps tool failures visible', () => {
  expect(transcript([{ id: 'plain', role: 'assistant', parts: [{ type: 'text', text: 'Hello' }] }])).not.toContain('<iframe');
  const failed = drawing('failure');
  (failed.parts[0] as { output: unknown }).output = { error: 'Canvas is disabled.' };
  const html = transcript([failed]);
  expect(html).not.toContain('<iframe');
  expect(html).toContain('Canvas is disabled.');
});
