import { canReloadChat } from './chat-reload';
import { readSession } from '../lib/sessions';
import type { ChatTransitionsOptions } from './use-chat-transitions';
import { activateChat, restoreChatSelection } from './chat-activation';
import type { WorkspaceChat } from './workspace-chat';

export type ChatLoad = { id: string; status: 'loading' } | { id: string; status: 'error'; message: string };

export function createChatResume(options: ChatTransitionsOptions) {
  const { transitionIntent, chats, renderedViews, setActive, setLoad } = options;

  return async (id: string, settings?: { reload: boolean }) => {
    const intent = ++transitionIntent.current;
    restoreChatSelection(options);

    const existing = chats.current.get(id);
    if (existing && (!settings?.reload || !canReloadChat(existing))) {
      if (existing.disposed) {
        setLoad(undefined);

        return;
      }
      if (renderedViews.current.has(existing)) {
        setLoad(undefined);
        setActive(existing);
      } else {
        await activateChat(existing, intent, options);
      }

      return;
    }
    await loadSavedChat(id, intent, existing, options);
  };
}

async function loadSavedChat(id: string, intent: number, existing: WorkspaceChat | undefined, options: ChatTransitionsOptions) {
  const { transitionIntent, setLoad, setActive, refresh, createChat, api } = options;
  setLoad({ id, status: 'loading' });

  try {
    const record = await readSession(id, api);
    if (intent !== transitionIntent.current) return;

    if (!record) {
      setLoad({ id, status: 'error', message: 'This chat no longer exists.' });
      void refresh();

      return;
    }
    if (existing && !await existing.reload(record)) {
      setLoad(undefined);
      setActive(existing);

      return;
    }

    const next = existing ?? createChat(record.id, record.messages, record.parentId, record.title);
    if (intent !== transitionIntent.current) return;

    if (record.serverRunId) next.turns.reconnect(next.chat.resumeStream);

    await activateChat(next, intent, options);
  } catch (error) {
    if (intent !== transitionIntent.current) return;

    const message = error instanceof TypeError
      ? 'Could not load chat. Check your connection and try again.'
      : error instanceof Error ? error.message : 'Could not load chat. Try again.';
    setLoad({ id, status: 'error', message });
  }
}
