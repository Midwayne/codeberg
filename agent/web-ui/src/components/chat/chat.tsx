import { ChatError } from './chat-error';
import { ChatCanvasActions } from '../../canvas/chat-actions';
import { canvasAnchor } from '../../canvas/conversation';
import { useChatScroll } from './use-chat-scroll';
import { useProjectApi } from '../../lib/project-api';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { MessageList } from './message-list';
import { MessageRail } from './message-rail';
import { PromptInput } from './prompt-input';
import { ChatEmptyState } from './chat-empty';
import { messageIndexById } from '../../lib/branch';

import { type CatalogModel } from '../../lib/models';

// `useChat` lives in the parent `Workspace` (which also owns session state), so
// `Chat` is presentational over the helpers it returns. Branching is a session
// operation: this component only reports the message index to branch through.
export type ChatProps = {
  chat: UseChatHelpers<UIMessage>;
  onBranch?: (throughIndex: number) => void;
  sessionId: string;
  learningEnabled: boolean;
  chatInputs: CatalogModel['inputs'];
  jump?: { messageId: string; nonce: number };
};

export function Chat(props: ChatProps) {
  const state = useChatView(props);

  return <ChatView {...state} />;
}

export type ChatViewOptions = {
  chat: UseChatHelpers<UIMessage>;
  onBranch?: (throughIndex: number) => void;
  sessionId: string;
  learningEnabled: boolean;
  chatInputs: CatalogModel['inputs'];
  jump?: { messageId: string; nonce: number };
};

export function useChatView({ chat, onBranch, sessionId, learningEnabled, chatInputs, jump }: ChatViewOptions) {
  const { ready } = useProjectApi();
  const { messages, sendMessage, status, stop, regenerate, error } = chat;
  const busy = status === 'submitted' || status === 'streaming';
  const branchAt = !busy && onBranch ? onBranch : undefined;
  const [draft, setDraft] = useState('');
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const { scrollRef, bottomRef, holdAutoScroll, holdTimer } = useChatScroll({ jump, messages, status });

  return {
    scrollRef,
    messages,
    hasCanvas: Boolean(canvasAnchor(messages)),
    setDraft,
    promptRef,
    sessionId,
    learningEnabled,
    busy,
    ready,
    regenerate,
    onBranch,
    status,
    error,
    bottomRef,
    holdAutoScroll,
    holdTimer,
    branchAt,
    draft,
    chatInputs,
    sendMessage,
    stop,
  };
}

export type ChatViewProps = ReturnType<typeof useChatView>;

export function ChatView(state: ChatViewProps) {
  return (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ChatCanvasActions messages={state.messages} sessionId={state.sessionId} />
        <div ref={state.scrollRef} className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          <div className={`mx-auto flex max-w-3xl flex-col gap-6 px-4 sm:px-8 ${state.hasCanvas ? 'pt-16 pb-6 lg:pt-6' : 'py-6'}`}>
            {state.messages.length === 0 && (
              <ChatEmptyState
                onChoose={(question) => {
                  state.setDraft(question);
                  state.promptRef.current?.focus();
                }}
              />
            )}

            <MessageList
              messages={state.messages}
              sessionId={state.sessionId}
              learningEnabled={state.learningEnabled}
              busy={state.busy}
              onRegenerate={() => {
                if (state.ready) void state.regenerate();
              }}
              onBranch={state.onBranch}
            />

            {state.status === 'submitted' && (
              <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                Thinking…
              </div>
            )}

            <ChatError state={state} />

            <div ref={state.bottomRef} />
          </div>
        </div>
        <ChatNavigation state={state} />
      </div>

      <ChatComposer state={state} />
    </>
  );
}

export type ChatComposerProps = { state: Parameters<typeof ChatView>[0] };

function ChatComposer({ state }: ChatComposerProps) {
  return (
    <div className="shrink-0 border-t border-border bg-background">
      <div className="mx-auto max-w-3xl px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-8">
        <PromptInput
          value={state.draft}
          onValueChange={state.setDraft}
          inputRef={state.promptRef}
          busy={state.busy}
          disabled={!state.ready}
          inputs={state.chatInputs}
          onSend={(text, files) => state.sendMessage({ text, ...(files.length ? { files } : {}) })}
          onStop={state.stop}
        />
      </div>
    </div>
  );
}

export type ChatNavigationProps = { state: Parameters<typeof ChatView>[0] };

function ChatNavigation({ state }: ChatNavigationProps) {
  return (
    <MessageRail
      scrollRef={state.scrollRef}
      messages={state.messages}
      onNavigate={() => {
        state.holdAutoScroll.current = true;
        window.clearTimeout(state.holdTimer.current);
        state.holdTimer.current = window.setTimeout(() => {
          state.holdAutoScroll.current = false;
        }, 700);
      }}
      onBranch={
        state.branchAt
          ? (id) => {
              const index = messageIndexById(state.messages, id);
              if (index >= 0) state.branchAt!(index);
            }
          : undefined
      }
    />
  );
}
