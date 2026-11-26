import { ChatError } from './chat-error';
import { ChatCanvasActions } from '../../canvas/chat-actions';
import { canvasAnchor } from '../../canvas/conversation';
import { useCanvasSettings } from '../../canvas/use-settings';
import { useChatScroll } from './use-chat-scroll';
import { useProjectApi } from '../../lib/project-api';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { TurnQueue } from '../../sessions/turn-queue';
import { useTurnQueue } from './use-turn-queue';
import { WorkingStatus } from './working-status';
import { QueuedFollowUps } from './queued-follow-ups';

import { MessageList } from './message-list';
import { MessageRail } from './message-rail';
import { PromptInput } from './prompt-input';
import { ChatEmptyState } from './chat-empty';
import { ContextMeter } from './context-meter';

import type { CatalogModel } from '../../lib/models';

// Each retained workspace view subscribes to its own session with `useChat`.
// `Chat` presents those helpers. Branching is a session
// operation: this component only reports the message index to branch through.
export type ChatProps = {
  chat: UseChatHelpers<UIMessage>;
  turns?: TurnQueue;
  onBranch?: (throughIndex: number) => void;
  sessionId: string;
  learningEnabled: boolean;
  chatInputs: CatalogModel['inputs'];
  jump?: { messageId: string; nonce: number };
  draftStore?: { text: string };
  /** Marks where a chat branched during this page session. */
  branch?: { parentTitle: string; messageCount: number };
};

export function Chat(props: ChatProps) {
  const state = useChatView(props);

  return <ChatView {...state} />;
}

type ChatViewOptions = ChatProps;

export function useChatView({ chat, turns, onBranch, sessionId, learningEnabled, chatInputs, jump, draftStore, branch }: ChatViewOptions) {
  const { ready } = useProjectApi();
  const { messages, status, error } = chat;
  const queue = useTurnQueue(turns, chat);
  const busy = status === 'submitted' || status === 'streaming' || queue.snapshot.steering;
  const [draft, updateDraft] = useState(draftStore?.text ?? '');

  const setDraft = (text: string) => {
    if (draftStore) draftStore.text = text;

    updateDraft(text);
  };

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const { scrollRef, holdScroll } = useChatScroll({ jump, messages, status });
  const hasCanvas = useMemo(() => Boolean(canvasAnchor(messages)), [messages]);

  return {
    scrollRef,
    messages,
    hasCanvas,
    setDraft,
    promptRef,
    sessionId,
    learningEnabled,
    busy,
    ready,
    regenerate: queue.regenerate,
    onBranch,
    branch,
    status,
    error,
    holdScroll,
    draft,
    chatInputs,
    queue,
  };
}

type ChatViewProps = ReturnType<typeof useChatView>;

export function ChatView(state: ChatViewProps) {
  const { ready, regenerate } = state;
  const empty = state.messages.length === 0;
  const onRegenerate = useCallback(() => {
    if (ready) void regenerate();
  }, [ready, regenerate]);

  return (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ChatCanvasActions messages={state.messages} sessionId={state.sessionId} />
        <div ref={state.scrollRef} className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          <div className={`mx-auto flex max-w-4xl flex-col gap-6 px-4 sm:px-8 ${contentSpacing(state.hasCanvas, empty)}`}>
            {empty && <ChatEmptyState />}

            <MessageList
              messages={state.messages}
              sessionId={state.sessionId}
              learningEnabled={state.learningEnabled}
              busy={state.busy}
              onRegenerate={onRegenerate}
              onBranch={state.onBranch}
              branch={state.branch}
            />

            <WorkingStatus status={state.status} messages={state.messages} steering={state.queue.snapshot.steering} />

            <ChatError state={state} />
          </div>
        </div>
        <ChatNavigation state={state} />
      </div>

      <ChatComposer state={state} />

      {/* Equal space below the composer centers a new chat's greeting and composer. */}
      {empty && <div aria-hidden="true" className="hidden flex-1 sm:block" />}
    </>
  );
}

function contentSpacing(hasCanvas: boolean, empty: boolean): string {
  if (empty) return 'min-h-full justify-center py-6 sm:justify-end sm:pb-4';

  return hasCanvas ? 'pt-16 pb-6 lg:pt-6' : 'py-6';
}

type ChatComposerProps = { state: Parameters<typeof ChatView>[0] };

function ChatComposer({ state }: ChatComposerProps) {
  const { enabled: canvasEnabled } = useCanvasSettings();

  return (
    <section aria-label="Message composer" className="chat-composer shrink-0 bg-background">
      <div className="mx-auto max-w-4xl px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-8">
        <QueuedFollowUps queue={state.queue} busy={state.busy} failed={state.status === 'error'} />
        <PromptInput
          key={state.sessionId}
          value={state.draft}
          onValueChange={state.setDraft}
          inputRef={state.promptRef}
          busy={state.busy}
          disabled={!state.ready}
          inputs={state.chatInputs}
          diagrams={canvasEnabled === true}
          onSend={state.queue.send}
          onSteer={state.queue.steer}
          onStop={state.queue.stop}
          accessory={<ContextMeter sessionId={state.sessionId} busy={state.busy} />}
        />
      </div>
    </section>
  );
}

type ChatNavigationProps = { state: Parameters<typeof ChatView>[0] };

function ChatNavigation({ state }: ChatNavigationProps) {
  return (
    <MessageRail
      scrollRef={state.scrollRef}
      messages={state.messages}
      onNavigate={state.holdScroll}
    />
  );
}
