import { useChat } from '@ai-sdk/react';
import { Activity, useLayoutEffect, useState } from 'react';

import { retainChatViews } from '../../sessions/retained-chats';
import type { WorkspaceChat } from '../../sessions/workspace-chat';
import { Chat, type ChatProps } from '../chat/chat';
import { ChatSaveNotice } from '../chat/chat-save-notice';
import { usePauseMedia } from '../chat/use-pause-media';

type ChatViewsProps = Pick<ChatProps, 'learningEnabled' | 'chatInputs' | 'onBranch' | 'jump'> & {
  active: WorkspaceChat;
  renderedViews: React.RefObject<ReadonlySet<WorkspaceChat>>;
  hidden?: boolean;
};

/** Recent views keep their DOM and draft; hidden views release their effects. */
export function ChatViews({ active, hidden, renderedViews, ...props }: ChatViewsProps) {
  const [views, setViews] = useState(() => [active]);

  if (views[0] !== active || views.some((view) => view !== active && view.disposed)) {
    setViews(retainChatViews(views, active));
  }

  useLayoutEffect(() => {
    renderedViews.current = new Set(views);

    return () => {
      renderedViews.current = new Set();
    };
  }, [views, renderedViews]);

  return views.map((view) => (
    <Activity key={view.id} mode={!hidden && view === active ? 'visible' : 'hidden'}>
      <RetainedChat {...props} active={view} jump={view === active ? props.jump : undefined} />
    </Activity>
  ));
}

function RetainedChat({ active, ...props }: Omit<ChatViewsProps, 'renderedViews'>) {
  const chat = useChat({ chat: active.chat });
  const mediaRef = usePauseMedia();

  return (
    <div ref={mediaRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ChatSaveNotice state={active.persistence} />
      <Chat {...props} chat={chat} turns={active.turns} sessionId={active.id} draftStore={active.draft} />
    </div>
  );
}
