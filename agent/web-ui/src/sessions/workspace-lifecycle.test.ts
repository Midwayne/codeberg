import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import { expect, it, vi } from 'vitest';

import { createWorkspaceChat, type WorkspaceChatSave } from './workspace-chat';

class PendingTransport implements ChatTransport<UIMessage> {
  requests: ReadableStreamDefaultController<UIMessageChunk>[] = [];

  sendMessages: ChatTransport<UIMessage>['sendMessages'] = async () =>
    new ReadableStream({
      start: (controller) => {
        this.requests.push(controller);
      },
    });

  reconnectToStream = async () => null;

  finish(index: number, text: string) {
    const controller = this.requests[index]!;
    controller.enqueue({ type: 'start', messageId: 'answer' });
    controller.enqueue({ type: 'text-start', id: 'text' });
    controller.enqueue({ type: 'text-delta', id: 'text', delta: text });
    controller.enqueue({ type: 'text-end', id: 'text' });
    controller.enqueue({ type: 'finish' });
    controller.close();
  }
}

it.each([false, true])('saves a submitted prompt before streaming (existing chat: %s)', async (existing) => {
  const messages: UIMessage[] = existing ? [
    { id: 'old-user', role: 'user', parts: [{ type: 'text', text: 'Earlier question' }] },
    { id: 'old-answer', role: 'assistant', parts: [{ type: 'text', text: 'Earlier answer' }] },
  ] : [];
  const transport = new PendingTransport();
  const saves: WorkspaceChatSave[] = [];
  const onPersist = vi.fn();
  const workspace = createWorkspaceChat({
    id: 'chat',
    messages,
    transport,
    onPersist,
    persist: async (record) => {
      saves.push(record);
    },
  });

  const sending = workspace.chat.sendMessage({ text: 'New question' });
  await expect.poll(() => transport.requests.length).toBe(1);

  expect(saves).toHaveLength(1);
  expect(saves[0]!.messages).toEqual(workspace.chat.messages);
  expect(saves[0]!.messages.at(-1)?.role).toBe('user');
  expect(onPersist).toHaveBeenCalledOnce();

  transport.requests[0]!.error(new Error('Provider unavailable'));
  await sending;

  expect(workspace.chat.status).toBe('error');
  expect(saves[0]!.messages.at(-1)?.parts).toEqual([{ type: 'text', text: 'New question' }]);
});

it('serializes prompt and completion saves and persists regenerated answers with the same id', async () => {
  const transport = new PendingTransport();
  const saves: WorkspaceChatSave[] = [];
  let release!: () => void;
  const pendingSave = new Promise<void>((resolve) => {
    release = resolve;
  });
  const workspace = createWorkspaceChat({
    id: 'chat',
    messages: [],
    transport,
    persist: async (record) => {
      saves.push(record);
      if (saves.length === 1) await pendingSave;
    },
  });

  const sending = workspace.chat.sendMessage({ text: 'Question' });
  await expect.poll(() => saves.length).toBe(1);
  expect(transport.requests).toHaveLength(0);

  release();
  await expect.poll(() => transport.requests.length).toBe(1);
  transport.finish(0, 'First answer');
  await sending;
  await expect.poll(() => saves.length).toBe(2);

  const retrying = workspace.chat.regenerate();
  await expect.poll(() => transport.requests.length).toBe(2);
  transport.finish(1, 'Replacement answer');
  await retrying;

  await expect.poll(() => saves.at(-1)?.messages.at(-1)?.parts).toContainEqual(
    expect.objectContaining({ text: 'Replacement answer' }),
  );
});

it.each(['stop', 'dispose'] as const)('does not start generation after %s during the initial save', async (action) => {
  const transport = new PendingTransport();
  let release!: () => void;
  const pendingSave = new Promise<void>((resolve) => {
    release = resolve;
  });
  const persist = vi.fn(() => pendingSave);
  const workspace = createWorkspaceChat({ id: 'chat', messages: [], transport, persist });

  const sending = workspace.chat.sendMessage({ text: 'Question' });
  await expect.poll(() => persist.mock.calls.length).toBe(1);
  let settled = false;
  const stopping = (action === 'stop' ? workspace.turns.stop() : workspace.dispose())
    .then(() => {
      settled = true;
    });
  await Promise.resolve();

  if (action === 'dispose') expect(settled).toBe(false);

  release();
  await stopping;
  await sending;

  expect(workspace.chat.status).toBe('ready');
  expect(transport.requests).toHaveLength(0);
});
