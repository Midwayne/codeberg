import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import { expect, it, vi } from 'vitest';

import { ProjectChatRegistry } from './project-chat-registry';
import { createWorkspaceChat } from './workspace-chat';

it.each([false, true])('reattaches after leaving a streaming project (existing chat: %s)', async (existing) => {
  const registry = new ProjectChatRegistry();
  const project = registry.forProject('first');
  const persist = vi.fn(async () => {});
  let controller!: ReadableStreamDefaultController<UIMessageChunk>;
  const transport: ChatTransport<UIMessage> = {
    sendMessages: async () => new ReadableStream({
      start: (next) => {
        controller = next;
      },
    }),
    reconnectToStream: async () => null,
  };
  const messages: UIMessage[] = existing ? [
    { id: 'old-user', role: 'user', parts: [{ type: 'text', text: 'Earlier question' }] },
    { id: 'old-answer', role: 'assistant', parts: [{ type: 'text', text: 'Earlier answer' }] },
  ] : [];
  const chat = createWorkspaceChat({
    id: 'chat',
    messages,
    transport,
    persist,
    onPersist: project.persisted,
  });
  project.chats.set(chat.id, chat);
  project.active = chat;

  const firstView = vi.fn();
  const leaveView = project.subscribe(firstView);

  const sending = chat.chat.sendMessage({ text: 'Keep investigating' });
  await expect.poll(() => persist.mock.calls.length).toBe(1);
  leaveView();
  const other = registry.forProject('second');

  expect(other.chats.size).toBe(0);
  expect(other.active).toBeUndefined();

  const returned = registry.forProject('first');
  const returningView = vi.fn();
  returned.subscribe(returningView);

  expect(returned.chats.get(chat.id)).toBe(chat);
  expect(returned.active).toBe(chat);
  expect(chat.chat.status).toBe('submitted');

  controller.enqueue({ type: 'start', messageId: 'answer' });
  controller.enqueue({ type: 'text-start', id: 'text' });
  controller.enqueue({ type: 'text-delta', id: 'text', delta: 'Finished in background' });
  controller.enqueue({ type: 'text-end', id: 'text' });
  controller.enqueue({ type: 'finish' });
  controller.close();
  await sending;
  await expect.poll(() => returningView.mock.calls.length).toBe(1);

  expect(firstView).toHaveBeenCalledOnce();
  expect(persist).toHaveBeenCalledTimes(2);
  expect(returned.active!.chat.messages.at(-1)?.parts).toContainEqual(
    expect.objectContaining({ text: 'Finished in background' }),
  );
});

it('disposes deleted projects and starts fresh when the same project is added again', async () => {
  const registry = new ProjectChatRegistry();
  const project = registry.forProject('deleted');
  const survivor = registry.forProject('retained');
  const chat = createWorkspaceChat({ id: 'old-chat', messages: [], persist: async () => {} });
  const dispose = vi.spyOn(chat, 'dispose');
  project.chats.set(chat.id, chat);
  project.active = chat;

  registry.retain(['retained']);

  expect(dispose).toHaveBeenCalledOnce();
  expect(registry.forProject('retained')).toBe(survivor);
  expect(registry.forProject('deleted')).not.toBe(project);
  expect(registry.forProject('deleted').chats.size).toBe(0);
  expect(registry.forProject('deleted').active).toBeUndefined();
});

it('isolates identical chat ids between projects', () => {
  const registry = new ProjectChatRegistry();
  const first = registry.forProject('first');
  const second = registry.forProject('second');
  const chatA = createWorkspaceChat({ id: 'same', messages: [], persist: async () => {} });
  const chatB = createWorkspaceChat({ id: 'same', messages: [], persist: async () => {} });
  first.chats.set(chatA.id, chatA);
  first.active = chatA;
  second.chats.set(chatB.id, chatB);
  second.active = chatB;

  expect(registry.forProject('first').active).toBe(chatA);
  expect(registry.forProject('second').active).toBe(chatB);
  registry.retain(['second']);
  expect(chatA.disposed).toBe(true);
  expect(chatB.disposed).toBe(false);
});
