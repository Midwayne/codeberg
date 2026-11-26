import type { ChatTransport, UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import type { ModelSelection } from '../lib/models';
import { ChatModelChoice } from './chat-model';
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
const small: ModelSelection = { key: 'openai:small', effort: 'low' };

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });

  return { promise, resolve, reject };
}

describe('chat-specific models', () => {
  it('sends each message with the model chosen for that chat when it was sent', async () => {
    const transport = new RecordingTransport();
    const workspace = createWorkspaceChat({ id: 'chat', messages: [], transport, persist: async () => undefined });

    await workspace.chat.sendMessage({ text: 'first' });
    await workspace.setModel(large);
    await workspace.chat.sendMessage({ text: 'second' });

    expect(transport.bodies).toEqual([undefined, { model: large }]);
  });

  it('carries a new chat choice in its first save only, then saves changes on their own', async () => {
    const saves: WorkspaceChatSave[] = [];
    const changes: Array<ModelSelection | null> = [];
    const workspace = createWorkspaceChat({
      id: 'chat', messages: [], transport: new RecordingTransport(),
      persist: async (record) => {
        saves.push(record);
      },
      persistModel: async (model) => {
        changes.push(model);
      },
    });

    await workspace.setModel(large);
    await workspace.chat.sendMessage({ text: 'first' });
    await workspace.setModel(null);
    await workspace.chat.sendMessage({ text: 'second' });

    expect(saves.map((record) => 'model' in record ? record.model : 'kept')).toEqual([large, 'kept', 'kept', 'kept']);
    expect(changes).toEqual([null]);
  });

  it('never lets message saves of a saved chat touch its model', async () => {
    const saves: WorkspaceChatSave[] = [];
    const workspace = createWorkspaceChat({
      id: 'chat', origin: { model: null, saved: true }, transport: new RecordingTransport(),
      messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      persist: async (record) => {
        saves.push(record);
      },
    });

    await workspace.save();

    expect(saves).toHaveLength(1);
    expect(saves[0]).not.toHaveProperty('model');
  });
});

describe('ChatModelChoice', () => {
  it('keeps a change being saved when a reload brings the older record', async () => {
    const saving = deferred();
    const choice = new ChatModelChoice(small, true, () => saving.promise);

    const change = choice.choose(large);
    choice.restore(small);
    saving.resolve();
    await change;
    choice.restore(null);

    expect(choice.current).toBeNull();
  });

  it('restores the previous choice when saving a change fails', async () => {
    const choice = new ChatModelChoice(small, true, () => Promise.reject(new Error('offline')));

    await expect(choice.choose(large)).rejects.toThrow('offline');

    expect(choice.current).toEqual(small);
  });

  it('saves a choice made while the first message save was in flight', async () => {
    const changes: Array<ModelSelection | null> = [];
    const choice = new ChatModelChoice(null, false, async (model) => {
      changes.push(model);
    });

    const carried = choice.forMessageSave();
    await choice.choose(large);
    choice.messageSaved(carried);
    await Promise.resolve();

    expect(changes).toEqual([large]);
    expect(choice.forMessageSave()).toBeUndefined();
  });
});
