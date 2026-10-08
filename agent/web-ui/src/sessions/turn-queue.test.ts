import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import { expect, it } from 'vitest';

import { createWorkspaceChat } from './workspace-chat';

class Transport implements ChatTransport<UIMessage> {
  requests: { text: string; signal?: AbortSignal; controller: ReadableStreamDefaultController<UIMessageChunk> }[] = [];

  sendMessages: ChatTransport<UIMessage>['sendMessages'] = async ({ messages, abortSignal }) => {
    const last = messages.at(-1)!;
    const text = last.parts.filter((part) => part.type === 'text').map((part) => part.text).join('');

    return new ReadableStream<UIMessageChunk>({ start: (controller) => {
      this.requests.push({ text, signal: abortSignal, controller });
      abortSignal?.addEventListener('abort', () => controller.error(new DOMException('Stopped', 'AbortError')));
      controller.enqueue({ type: 'start', messageId: `answer-${this.requests.length}` });
      controller.enqueue({ type: 'text-start', id: 'text' });
      controller.enqueue({ type: 'text-delta', id: 'text', delta: 'Partial answer' });
    } });
  };

  reconnectToStream = async () => null;

  finish(index: number) {
    const controller = this.requests[index]!.controller;
    controller.enqueue({ type: 'text-end', id: 'text' });
    controller.enqueue({ type: 'finish' });
    controller.close();
  }
}

function fixture(id = 'chat') {
  const transport = new Transport();
  const workspace = createWorkspaceChat({ id, messages: [], transport, persist: async () => {} });

  return { transport, workspace, turns: workspace.turns };
}

it('queues follow-ups without inserting them into the active request, then sends in order', async () => {
  const { transport, turns, workspace } = fixture();
  turns.submit({ text: 'First' });
  await expect.poll(() => transport.requests.length).toBe(1);

  turns.submit({ text: 'Second' });
  turns.submit({ text: 'Third' });

  expect(turns.getSnapshot().items.map((item) => item.text)).toEqual(['Second', 'Third']);
  expect(workspace.chat.messages.filter((message) => message.role === 'user')).toHaveLength(1);

  transport.finish(0);
  await expect.poll(() => transport.requests.map((request) => request.text)).toEqual(['First', 'Second']);
  transport.finish(1);
  await expect.poll(() => transport.requests.map((request) => request.text)).toEqual(['First', 'Second', 'Third']);
  transport.finish(2);
  await expect.poll(() => workspace.chat.status).toBe('ready');
  expect(turns.getSnapshot().items).toEqual([]);
});

it('steers by aborting the current response, retaining partial text, and keeping other follow-ups', async () => {
  const { transport, turns, workspace } = fixture();
  turns.submit({ text: 'First' });
  await expect.poll(() => workspace.chat.status).toBe('streaming');
  turns.submit({ text: 'Later' });

  await turns.steer({ text: 'Focus on cancellation' });
  await expect.poll(() => transport.requests.map((request) => request.text)).toEqual(['First', 'Focus on cancellation']);

  expect(transport.requests[0]!.signal?.aborted).toBe(true);
  expect(workspace.chat.messages[1]?.parts).toContainEqual(expect.objectContaining({ text: 'Partial answer' }));
  expect(turns.getSnapshot().items.map((item) => item.text)).toEqual(['Later']);

  transport.finish(1);
  await expect.poll(() => transport.requests.length).toBe(3);
  transport.finish(2);
});

it('pauses queued questions on Stop, allows removal, and resumes only on request', async () => {
  const { transport, turns } = fixture();
  turns.submit({ text: 'First' });
  await expect.poll(() => transport.requests.length).toBe(1);
  turns.submit({ text: 'Remove me' });
  turns.submit({ text: 'Keep me' });

  await turns.stop();
  turns.remove(turns.getSnapshot().items[0]!.id);

  expect(turns.getSnapshot().paused).toBe(true);
  expect(transport.requests).toHaveLength(1);
  turns.resume();
  await expect.poll(() => transport.requests.map((request) => request.text)).toEqual(['First', 'Keep me']);
  transport.finish(1);
});

it('keeps queues isolated between chats and disposes queued work when the chat is deleted', async () => {
  const first = fixture('first');
  const second = fixture('second');
  first.turns.submit({ text: 'First chat' });
  second.turns.submit({ text: 'Second chat' });
  await expect.poll(() => first.transport.requests.length + second.transport.requests.length).toBe(2);
  first.turns.submit({ text: 'Queued in first' });

  expect(second.turns.getSnapshot().items).toEqual([]);
  first.workspace.dispose();
  second.transport.finish(0);
  await expect.poll(() => first.workspace.chat.status).toBe('ready');

  expect(first.transport.requests).toHaveLength(1);
  expect(first.turns.getSnapshot().items).toEqual([]);
});

it('holds queued work after a failure until an explicit retry', async () => {
  const { transport, turns, workspace } = fixture();
  turns.submit({ text: 'First' });
  await expect.poll(() => transport.requests.length).toBe(1);
  turns.submit({ text: 'Later' });
  transport.requests[0]!.controller.error(new Error('Connection lost'));

  await expect.poll(() => workspace.chat.status).toBe('error');
  await expect.poll(() => turns.getSnapshot().paused).toBe(true);
  expect(transport.requests).toHaveLength(1);

  turns.retry();
  await expect.poll(() => transport.requests.length).toBe(2);
  transport.finish(1);
  await expect.poll(() => transport.requests.length).toBe(3);
  transport.finish(2);
});

it('uses a selected queued instruction to steer while retaining the others in order', async () => {
  const { transport, turns } = fixture();
  turns.submit({ text: 'First' });
  await expect.poll(() => transport.requests.length).toBe(1);
  turns.submit({ text: 'Second' });
  turns.submit({ text: 'Steer with this' });
  turns.steerQueued(turns.getSnapshot().items[1]!.id);

  await expect.poll(() => transport.requests.map((request) => request.text)).toEqual(['First', 'Steer with this']);
  expect(turns.getSnapshot().items.map((item) => item.text)).toEqual(['Second']);
  transport.finish(1);
  await expect.poll(() => transport.requests.length).toBe(3);
  transport.finish(2);
});

it('preserves an instruction if Stop is pressed while steering is in progress', async () => {
  const { transport, turns } = fixture();
  turns.submit({ text: 'First' });
  await expect.poll(() => transport.requests.length).toBe(1);

  const steering = turns.steer({ text: 'New direction' });
  await turns.stop();
  await steering;

  expect(transport.requests).toHaveLength(1);
  expect(turns.getSnapshot().items.map((item) => item.text)).toEqual(['New direction']);
  expect(turns.getSnapshot().paused).toBe(true);
});
