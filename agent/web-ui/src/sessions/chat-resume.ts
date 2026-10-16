import { readSession } from '../lib/sessions';
import type { ChatTransitionsOptions } from './use-chat-transitions';
import { activateChat, restoreChatSelection } from './chat-activation';

export type ChatLoad = { id: string; status: 'loading' } | { id: string; status: 'error'; message: string };

export function createChatResume(options: ChatTransitionsOptions) {
  const { transitionIntent, chats, renderedViews, setActive, setLoad, api, refresh, createChat } = options;

  return async (id: string) => {
    const intent = ++transitionIntent.current;
    restoreChatSelection(options);

    const existing = chats.current.get(id);
    if (existing) {
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
    setLoad({ id, status: 'loading' });

    try {
      const record = await readSession(id, api);
      if (intent !== transitionIntent.current) return;

      if (!record) {
        setLoad({ id, status: 'error', message: 'This chat no longer exists.' });
        void refresh();

        return;
      }
      const next = createChat(record.id, record.messages, record.parentId, record.title);

      await activateChat(next, intent, options);
    } catch (error) {
      if (intent !== transitionIntent.current) return;

      const message = error instanceof TypeError
        ? 'Could not load chat. Check your connection and try again.'
        : error instanceof Error ? error.message : 'Could not load chat. Try again.';
      setLoad({ id, status: 'error', message });
    }
  };
}
