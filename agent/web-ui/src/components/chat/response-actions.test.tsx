import type { UseChatHelpers } from '@ai-sdk/react';
import type { UIMessage, UIMessageChunk } from 'ai';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { RunTransport } from '../../sessions/run-transport';
import { createWorkspaceChat, type WorkspaceChat } from '../../sessions/workspace-chat';
import { useChatView } from './chat';
import { ChatError } from './chat-error';

function events(text = 'Original answer', broken = false): Response {
  const chunks: UIMessageChunk[] = [
    { type: 'start', messageId: 'answer' }, { type: 'text-start', id: 'text' },
    { type: 'text-delta', id: 'text', delta: text }, { type: 'text-end', id: 'text' }, { type: 'finish' },
  ];
  if (broken) chunks.splice(-2);
  const encoder = new TextEncoder();
  let index = 0;

  return new Response(new ReadableStream({ pull(controller) {
    if (index < chunks.length) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunks[index++])}\n\n`));
    else if (broken) controller.error(new TypeError('terminated'));
    else controller.close();
  } }), { headers: { 'content-type': 'text/event-stream', 'x-codeberg-run': 'run' } });
}

function view(workspace: WorkspaceChat) {
  let state!: ReturnType<typeof useChatView>;
  function Probe() {
    state = useChatView({ chat: workspace.chat as unknown as UseChatHelpers<UIMessage>, turns: workspace.turns,
      sessionId: workspace.id, learningEnabled: false, chatInputs: ['text'] });
    return null;
  }
  renderToStaticMarkup(<Probe />);

  return state;
}

it('Regenerate submits a fresh request and replaces the completed answer', async () => {
  const bodies: Record<string, any>[] = [];
  const api = vi.fn<typeof fetch>(async (url, options) => {
    if (options?.method === 'POST') {
      bodies.push(JSON.parse(String(options.body)));
      return events(bodies.length === 1 ? 'Original answer' : 'Fresh answer');
    }
    if (String(url).includes('/run')) return Response.json({ id: 'run', status: 'completed' });

    return events();
  });
  const workspace = createWorkspaceChat({ id: 'chat', messages: [], transport: new RunTransport(api),
    serverOwned: true, persist: async () => {} });
  await workspace.chat.sendMessage({ text: 'Find auth' });

  view(workspace).regenerate();

  await vi.waitFor(() => expect(bodies).toHaveLength(2));
  await vi.waitFor(() => expect(workspace.chat.status).toBe('ready'));
  expect(bodies[1]!.trigger).toBe('regenerate-message');
  expect(bodies[1]!.requestId).not.toBe(bodies[0]!.requestId);
  expect(bodies[1]!.messages).toEqual([workspace.chat.messages[0]]);
  expect(workspace.chat.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  expect(workspace.chat.messages[1]?.parts).toEqual([{ type: 'text', text: 'Fresh answer', state: 'done' }]);
});

it('the error Retry button recovers the completed server run without a fresh submission', async () => {
  const api = vi.fn<typeof fetch>().mockResolvedValueOnce(events('Partial answer', true));
  for (let attempt = 0; attempt < 3; attempt++) api.mockRejectedValueOnce(new TypeError('offline'));

  const workspace = createWorkspaceChat({ id: 'chat', messages: [], transport: new RunTransport(api, () => Promise.resolve()),
    serverOwned: true, persist: async () => {} });
  await workspace.chat.sendMessage({ text: 'Find auth' });
  expect(workspace.chat.status).toBe('error');
  const state = view(workspace);
  api.mockImplementation(async (url) => String(url).includes('/run')
    ? Response.json({ id: 'run', status: 'completed' }) : events('Recovered answer'));
  const notice = ChatError({ state });
  if (!notice) throw new Error('Expected a retry notice');

  notice.props.children[2].props.onClick();

  await vi.waitFor(() => expect(workspace.chat.messages[1]?.parts).toContainEqual(
    expect.objectContaining({ text: 'Recovered answer' }),
  ));
  expect(api.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
});
