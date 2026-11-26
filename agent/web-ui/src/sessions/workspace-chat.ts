import { Chat } from '@ai-sdk/react';
import type { ChatTransport, UIMessage } from 'ai';

import { RunTransport } from './run-transport';
import { TurnQueue } from './turn-queue';
import { chatPersistence } from './workspace-persistence';
import { persistingTransport } from './persisting-transport';
import type { ChatSaveState } from './chat-save-state';
import { reloadWorkspaceChat } from './chat-reload';
import type { SaveSessionInput } from '../lib/sessions';
import type { ModelSelection } from '../lib/models';
import { ChatModelChoice, chatModelTransport } from './chat-model';

export type WorkspaceChatSave = SaveSessionInput;

/** Where a chat forked, so its view can mark the copied part of the transcript. */
interface ChatBranchOrigin {
  parentTitle: string;
  messageCount: number;
  /** Set once the arrival animation has played, so reopening the chat stays still. */
  announced?: boolean;
}

export interface WorkspaceChat {
  id: string;
  title?: string;
  parentId?: string;
  /** Present only on a chat branched during this page session. */
  branch?: ChatBranchOrigin;
  chat: Chat<UIMessage>;
  /** This chat's own model; the next message runs on it. */
  model: ChatModelChoice;
  /** Choose this chat's model, or `null` to follow the default, and save it with the chat. */
  setModel: (model: ModelSelection | null) => Promise<void>;
  turns: TurnQueue;
  persistence: ChatSaveState;
  /** Unsent text belongs to this tab's session, independently of retained DOM. */
  draft: { text: string };
  readonly disposed: boolean;
  readonly createdAt: number;
  dispose: () => Promise<void>;
  /** Write the current transcript through the same queue as turn saves. */
  save: () => Promise<void>;
  reload: (record: WorkspaceChatSave) => Promise<boolean>;
}

/** Opens a chat in the project registry; `model` restores its own model choice. */
export type CreateChat = (
  id: string,
  messages: UIMessage[],
  parentId?: string,
  title?: string,
  origin?: ChatOrigin,
) => WorkspaceChat;

/** A chat's own model, and whether it came from a record the server already has. */
export type ChatOrigin = { model?: ModelSelection | null; saved?: boolean };

interface CreateWorkspaceChatOptions {
  id: string;
  messages: UIMessage[];
  title?: string;
  parentId?: string;
  origin?: ChatOrigin;
  transport?: ChatTransport<UIMessage>;
  persist: (record: WorkspaceChatSave) => Promise<void>;
  /** Save a model change on a chat the server already has. */
  persistModel?: (model: ModelSelection | null) => Promise<void>;
  onPersist?: () => void;
  serverOwned?: boolean;
}

/** Creates one independently streaming chat whose completion persists to its owning session. */
export function createWorkspaceChat(options: CreateWorkspaceChatOptions): WorkspaceChat {
  const { id, messages, title, parentId, transport, persist, onPersist, serverOwned = transport === undefined } = options;
  let disposed = false;
  const runTransport = transport instanceof RunTransport ? transport : transport ? undefined : new RunTransport();
  const model = new ChatModelChoice(options.origin?.model ?? null, options.origin?.saved === true, options.persistModel);
  const persistence = chatPersistence({
    serverOwned,
    id,
    get title() { return workspace.title; },
    get parentId() { return workspace.parentId; },
    model,
    persist,
    onPersist,
    disposed: () => disposed,
    setMessages: (next) => {
      chat.messages = next;
    },
  });
  const savedTransport = persistingTransport(chatModelTransport(transport ?? runTransport!, model), persistence.save);
  const chat = new Chat<UIMessage>({
    id,
    messages,
    transport: savedTransport,
    onFinish: persistence.onFinish,
  });
  const turns = createTurnQueue(chat, savedTransport.isPending, runTransport);

  const workspace: WorkspaceChat = {
    id,
    title,
    parentId,
    chat,
    model,
    setModel: (next) => model.choose(next),
    turns,
    persistence: persistence.state,
    draft: { text: '' },
    createdAt: Date.now(),
    save: () => persistence.save(chat.messages),
    reload: (record) => reloadWorkspaceChat(workspace, record, persistence.settled, () => runTransport?.reset()),
    get disposed() { return disposed; },
    dispose: async () => {
      disposed = true;
      turns.dispose();
      await persistence.settled();
    },
  };

  return workspace;
}

function createTurnQueue(chat: Chat<UIMessage>, isPending: () => boolean, transport?: RunTransport) {
  transport?.bindMessages(() => chat.messages);

  return new TurnQueue(chat, transport ? {
    stop: async () => {
      if (isPending() && !transport.isReplaying) {
        return false;
      }
      await transport.stop(chat.id);
      return true;
    },
    retry: () => transport.retry(chat),
    synchronize: () => transport.synchronize(chat),
  } : undefined);
}
