import type { ChatTransport, UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import type { ModelSelection } from '../lib/models';
import { createWorkspaceChat, type WorkspaceChatSave } from './workspace-chat';

class RecordingTransport implements ChatTransport<UIMessage> {
  readonly bodies: unknown[] = [];

  sendMessages: ChatTransport<UIMessage>['sendMessages'] = async (request) => {
    this.bodies.push(request.body);
    const messageId = `answer-${this.bodies.length}`;

    return new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'start', messageId });
        controller.enqueue({ type: 'finish' });
        controller.close();
      },
    });
  };

  reconnectToStream = async () => null;
}

const large: ModelSelection = { key: 'openai:large', effort: 'high' };

describe('chat-specific models', () => {
  it('sends each message with the model chosen for that chat when it was sent', async () => {
    const transport = new RecordingTransport();
    const saves: WorkspaceChatSave[] = [];
    const workspace = createWorkspaceChat({ id: 'chat', messages: [], transport, persist: async (record) => {
      saves.push(record);
    } });

    await workspace.chat.sendMessage({ text: 'first' });
    await workspace.setModel(large);
    await workspace.chat.sendMessage({ text: 'second' });

    expect(transport.bodies).toEqual([undefined, { model: large }]);
    expect(saves.at(-1)?.model).toEqual(large);
  });

  it('saves a change on a chat the server has, and leaves an empty chat to its first save', async () => {
    const changes: Array<ModelSelection | null> = [];
    const persistModel = async (model: ModelSelection | null) => {
      changes.push(model);
    };
    const options = { transport: new RecordingTransport(), persist: async () => undefined, persistModel };
    const empty = createWorkspaceChat({ ...options, id: 'empty', messages: [] });
    const saved = createWorkspaceChat({ ...options, id: 'saved', model: large,
      messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] });

    await empty.setModel(large);
    await saved.setModel(null);

    expect(empty.model.current).toEqual(large);
    expect(changes).toEqual([null]);
  });
});
