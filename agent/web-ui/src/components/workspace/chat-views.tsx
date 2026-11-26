import { useChat } from '@ai-sdk/react';
import { Activity, useEffect, useLayoutEffect, useState } from 'react';

import { retainChatViews } from '../../sessions/retained-chats';
import type { WorkspaceChat } from '../../sessions/workspace-chat';
import { Chat, type ChatProps } from '../chat/chat';
import { ChatSaveNotice } from '../chat/chat-save-notice';
import { usePauseMedia } from '../chat/use-pause-media';

type ChatViewsProps = Pick<ChatProps, 'learningEnabled' | 'chatModels' | 'onBranch' | 'jump'> & {
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
  // Batch streamed tokens into at most ~20 commits a second; the text itself is unchanged.
  const chat = useChat({ chat: active.chat, experimental_throttle: 50 });
  const mediaRef = usePauseMedia();
  const arrival = useBranchArrival(active);

  return (
    <div ref={mediaRef} data-branch-arrival={arrival} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ChatSaveNotice state={active.persistence} />
      <Chat {...props} chat={chat} model={active.model} onModelChange={active.setModel} turns={active.turns} sessionId={active.id} draftStore={active.draft} branch={active.branch} />
    </div>
  );
}

const BRANCH_ARRIVAL_MS = 600;

/** A new branch arrives once; returning to it later must not replay the motion. */
function useBranchArrival(active: WorkspaceChat) {
  const [arriving, setArriving] = useState(() => Boolean(active.branch && !active.branch.announced));

  // A timer, not `animationend`: reduced or instant motion may never run the animation.
  useEffect(() => {
    if (!arriving) return;

    const timer = window.setTimeout(() => {
      if (active.branch) active.branch.announced = true;

      setArriving(false);
    }, BRANCH_ARRIVAL_MS);

    return () => window.clearTimeout(timer);
  }, [arriving, active]);

  return arriving ? 'true' : undefined;
}
