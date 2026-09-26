import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import { describe, expect, it } from 'vitest';

import { createWorkspaceChat, type WorkspaceChatSave } from './workspace-chat';

interface PendingRequest {
  chatId: string;
  controller: ReadableStreamDefaultController<UIMessageChunk>;
}

class ControlledTransport implements ChatTransport<UIMessage> {
  readonly requests: PendingRequest[] = [];

  sendMessages = async ({ chatId }: { chatId: string }) => {
    let controller!: ReadableStreamDefaultController<UIMessageChunk>;
    const stream = new ReadableStream<UIMessageChunk>({
      start(next) {
        controller = next;
      },
    });
    this.requests.push({ chatId, controller });
    return stream;
  };

  reconnectToStream = async () => null;
}

function streamText(request: PendingRequest, messageId: string, textId: string, text: string) {
  request.controller.enqueue({ type: 'start', messageId });
  request.controller.enqueue({ type: 'text-start', id: textId });
  request.controller.enqueue({ type: 'text-delta', id: textId, delta: text });
}

function finishText(request: PendingRequest, textId: string) {
  request.controller.enqueue({ type: 'text-end', id: textId });
  request.controller.enqueue({ type: 'finish' });
  request.controller.close();
}

function text(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

describe('workspace chats', () => {
  it('keeps concurrent streams and persistence with their originating sessions', async () => {
    const transport = new ControlledTransport();
    const saves: WorkspaceChatSave[] = [];
    const persist = async (record: WorkspaceChatSave) => {
      saves.push(record);
    };
    const chatA = createWorkspaceChat({ id: 'chat-a', messages: [], persist, transport });
    const sendA = chatA.chat.sendMessage({ text: 'question A' });
    await expect
      .poll(() => transport.requests.map((request) => request.chatId))
      .toEqual(['chat-a']);
    const requestA = transport.requests[0];
    streamText(requestA, 'assistant-a', 'text-a', 'answer A');
    await expect.poll(() => chatA.chat.messages.map(text)).toEqual(['question A', 'answer A']);

    const chatB = createWorkspaceChat({
      id: 'chat-b',
      messages: [
        { id: 'old-user', role: 'user', parts: [{ type: 'text', text: 'previous question' }] },
        {
          id: 'old-assistant',
          role: 'assistant',
          parts: [{ type: 'text', text: 'previous answer' }],
        },
      ],
      persist,
      transport,
    });
    const sendB = chatB.chat.sendMessage({ text: 'question B' });

    await expect
      .poll(() => transport.requests.map((request) => request.chatId))
      .toEqual(['chat-a', 'chat-b']);

    const requestB = transport.requests[1];
    streamText(requestB, 'assistant-b', 'text-b', 'answer B');
    requestA.controller.enqueue({ type: 'text-delta', id: 'text-a', delta: ' continued' });

    await expect
      .poll(() => chatA.chat.messages.map(text))
      .toEqual(['question A', 'answer A continued']);
    await expect
      .poll(() => chatB.chat.messages.map(text))
      .toEqual(['previous question', 'previous answer', 'question B', 'answer B']);

    finishText(requestB, 'text-b');
    await sendB;
    finishText(requestA, 'text-a');
    await sendA;

    expect(saves.map(({ id }) => id)).toEqual(['chat-b', 'chat-a']);
    expect(saves.find(({ id }) => id === 'chat-a')?.messages.map(text)).toEqual([
      'question A',
      'answer A continued',
    ]);
    expect(saves.find(({ id }) => id === 'chat-b')?.messages.map(text)).toEqual([
      'previous question',
      'previous answer',
      'question B',
      'answer B',
    ]);
  });
});
