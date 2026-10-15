import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import { expect, it, vi } from 'vitest';

import { createWorkspaceChat, type WorkspaceChatSave } from './workspace-chat';

function fixture(persist: (record: WorkspaceChatSave) => Promise<void>) {
  let controller!: ReadableStreamDefaultController<UIMessageChunk>;
  const transport: ChatTransport<UIMessage> = {
    sendMessages: async () => new ReadableStream({ start: (next) => { controller = next; } }),
    reconnectToStream: async () => null,
  };
  const workspace = createWorkspaceChat({ id: 'chat', messages: [], transport, persist });
  const sending = workspace.chat.sendMessage({ text: 'Keep this question' });

  return { workspace, sending, stream: () => controller };
}

function partial(controller: ReadableStreamDefaultController<UIMessageChunk>) {
  controller.enqueue({ type: 'start', messageId: 'answer' });
  controller.enqueue({ type: 'text-start', id: 'text' });
  controller.enqueue({ type: 'text-delta', id: 'text', delta: 'Useful partial finding' });
}

it('keeps the response running after a failed save and allows saving again without regenerating', async () => {
  const persist = vi.fn(async () => {});
  persist.mockRejectedValueOnce(new Error('Disk unavailable'));
  const { workspace, sending, stream } = fixture(persist);
  await expect.poll(() => persist.mock.calls.length).toBe(1);

  expect(workspace.persistence.getSnapshot().error).toContain('Disk unavailable');
  partial(stream());
  stream().enqueue({ type: 'text-end', id: 'text' });
  stream().enqueue({ type: 'finish' });
  stream().close();
  await sending;

  await expect.poll(() => workspace.persistence.getSnapshot().error).toBeUndefined();
  expect(workspace.chat.messages).toHaveLength(2);
});

it('shows a completion save failure and retries the exact completed answer', async () => {
  const saves: WorkspaceChatSave[] = [];
  const persist = vi.fn(async (record: WorkspaceChatSave) => { saves.push(record); });
  const { workspace, sending, stream } = fixture(persist);
  await expect.poll(() => persist.mock.calls.length).toBe(1);
  persist.mockRejectedValueOnce(new Error('Disk full'));
  partial(stream());
  stream().enqueue({ type: 'text-end', id: 'text' });
  stream().enqueue({ type: 'finish' });
  stream().close();
  await sending;
  await expect.poll(() => workspace.persistence.getSnapshot().error).toContain('Disk full');

  await Promise.all([workspace.persistence.retry(), workspace.persistence.retry()]);

  expect(persist).toHaveBeenCalledTimes(3);
  expect(saves.at(-1)?.messages).toEqual(workspace.chat.messages);
  expect(workspace.persistence.getSnapshot().error).toBeUndefined();
});

it('saves useful partial output after a disconnect and settles unfinished tools', async () => {
  const saves: WorkspaceChatSave[] = [];
  const { workspace, sending, stream } = fixture(async (record) => { saves.push(record); });
  await expect.poll(() => saves.length).toBe(1);
  partial(stream());
  stream().enqueue({ type: 'tool-input-available', toolCallId: 'grep', toolName: 'grep', input: {} });
  await expect.poll(() => workspace.chat.messages.at(-1)?.parts.length).toBe(2);
  stream().error(new TypeError('Network connection lost'));
  await sending;

  await expect.poll(() => saves.length).toBe(2);
  expect(saves.at(-1)?.messages.at(-1)?.parts).toContainEqual(
    expect.objectContaining({ type: 'text', text: 'Useful partial finding', state: 'done' }),
  );
  expect(saves.at(-1)?.messages.at(-1)?.parts).toContainEqual(
    expect.objectContaining({ state: 'output-error', errorText: 'Response interrupted. Retry to continue.' }),
  );
});

it('ignores save retries on a disposed chat so deletion cannot recreate it', async () => {
  const persist = vi.fn(async () => {});
  const { workspace, sending, stream } = fixture(persist);
  await expect.poll(() => persist.mock.calls.length).toBe(1);
  partial(stream());
  persist.mockRejectedValueOnce(new Error('Disk full'));
  stream().enqueue({ type: 'text-end', id: 'text' });
  stream().enqueue({ type: 'finish' });
  stream().close();
  await sending;
  await expect.poll(() => workspace.persistence.getSnapshot().error).toContain('Disk full');

  await workspace.dispose();
  await workspace.persistence.retry();

  expect(persist).toHaveBeenCalledTimes(2);
});
