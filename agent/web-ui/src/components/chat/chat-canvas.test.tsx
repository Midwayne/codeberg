import { renderToStaticMarkup } from 'react-dom/server';
import type { UIMessage } from 'ai';
import { beforeEach, expect, it, vi } from 'vitest';

import { Chat, type ChatProps } from './chat';
import { ProjectApiContext } from '../../lib/project-api';

const settings = vi.hoisted(() => ({ enabled: true }));

vi.mock('../../canvas/use-settings', () => ({ useCanvasSettings: () => settings }));

beforeEach(() => {
  settings.enabled = true;
});

function drawing(state = 'output-available', output: unknown = { kind: 'canvas' }, id = 'drawing'): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [{ type: 'dynamic-tool', toolName: 'canvas_add', toolCallId: id, input: {}, state,
      ...(state === 'output-available' ? { output } : {}) }],
  } as UIMessage;
}

function renderChat(messages: UIMessage[], sessionId = 'current-chat', projectId = 'demo') {
  const chat = { messages, status: 'ready' } as ChatProps['chat'];

  return renderToStaticMarkup(
    <ProjectApiContext.Provider value={{ project: { id: projectId, name: 'Demo', roots: [] }, fetch, ready: true }}>
      <Chat chat={chat} sessionId={sessionId} learningEnabled={false} chatInputs={['text']} />
    </ProjectApiContext.Provider>,
  );
}

it('floats the canvas action within the chat, outside the scrolling transcript, without a header row', () => {
  const html = renderChat([drawing(), { id: 'later', role: 'user', parts: [{ type: 'text', text: 'Continue' }] }]);

  expect(html).toContain('aria-label="Open canvas in a new window"');
  expect(html).toContain('href="/canvas?chat=current-chat&amp;project=demo" target="_blank" rel="noreferrer"');
  const actions = html.match(/<nav aria-label="Chat actions"[\s\S]*?<\/nav>/)?.[0];

  expect(actions).toContain('absolute');
  expect(actions).not.toMatch(/\bborder-b(?:\s|")/);
  expect(html.indexOf('relative flex min-h-0')).toBeLessThan(html.indexOf('aria-label="Chat actions"'));
  expect(html.indexOf('aria-label="Chat actions"')).toBeLessThan(html.indexOf('overflow-y-auto'));
});

it('does not offer a canvas for empty chats, pending first drawings or failed drawings', () => {
  for (const messages of [[], [drawing('input-available')], [drawing('output-available', { error: 'Save failed' })]]) {
    expect(renderChat(messages)).not.toContain('aria-label="Chat actions"');
  }
});

it('keeps the action while a later drawing is pending', () => {
  expect(renderChat([drawing(), drawing('input-available', undefined, 'pending')]))
    .toContain('aria-label="Open canvas in a new window"');
});

it('pins the action to the active chat and project when switching or branching', () => {
  const html = renderChat([drawing()], 'branch-chat', 'other-project');

  const actions = html.match(/<nav aria-label="Chat actions"[\s\S]*?<\/nav>/)?.[0];

  expect(actions).toContain('href="/canvas?chat=branch-chat&amp;project=other-project"');
  expect(renderChat([], 'new-chat')).not.toContain('aria-label="Chat actions"');
});

it('hides the action when canvas is disabled for the project', () => {
  settings.enabled = false;

  expect(renderChat([drawing()])).not.toContain('aria-label="Chat actions"');
});
