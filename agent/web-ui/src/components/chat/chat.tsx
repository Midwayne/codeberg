import { useProjectApi } from '@/lib/project-api';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { MessageList } from './message-list';
import { MessageRail } from './message-rail';
import { PromptInput } from './prompt-input';
import { ChatEmptyState } from './chat-empty';
import { messageIndexById } from '@/lib/branch';
import { MESSAGE_ID_ATTR } from '@/lib/message-rail';
import type { CatalogModel } from '@/lib/models';

// `useChat` lives in the parent `Workspace` (which also owns session state), so
// `Chat` is presentational over the helpers it returns. Branching is a session
// operation: this component only reports the message index to branch through.
export function Chat({
  chat,
  onBranch,
  sessionId,
  learningEnabled,
  chatInputs,
  jump,
}: {
  chat: UseChatHelpers<UIMessage>;
  onBranch?: (throughIndex: number) => void;
  sessionId: string;
  learningEnabled: boolean;
  chatInputs: CatalogModel['inputs'];
  jump?: { messageId: string; nonce: number };
}) {
  const { ready } = useProjectApi();
  const { messages, sendMessage, status, stop, regenerate, error } = chat;
  const busy = status === 'submitted' || status === 'streaming';
  const branchAt = !busy && onBranch ? onBranch : undefined;
  const [draft, setDraft] = useState('');
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const holdAutoScroll = useRef(false);
  const holdTimer = useRef(0);
  const handledJump = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!jump || handledJump.current === jump.nonce) return;
    const target = scrollRef.current?.querySelector(`[${MESSAGE_ID_ATTR}="${CSS.escape(jump.messageId)}"]`);
    if (!(target instanceof HTMLElement)) return;
    handledJump.current = jump.nonce;
    holdAutoScroll.current = true;
    window.clearTimeout(holdTimer.current);
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    target.classList.remove('message-flash');
    void target.offsetWidth;
    target.classList.add('message-flash');
    holdTimer.current = window.setTimeout(() => { holdAutoScroll.current = false; }, 700);
  }, [jump, messages]);
  // Keep the view pinned to the latest content unless the user has scrolled up
  // or just jumped via the tick rail (smooth scroll would still look "near
  // bottom" for a frame and the pin would yank them back).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || holdAutoScroll.current) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, status]);

  return (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:px-8">
            {messages.length === 0 && <ChatEmptyState onChoose={(question) => { setDraft(question); promptRef.current?.focus(); }} />}

            <MessageList messages={messages} sessionId={sessionId} learningEnabled={learningEnabled}
              busy={busy} onRegenerate={() => { if (ready) void regenerate(); }} onBranch={onBranch} />

            {status === 'submitted' && (
              <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                Thinking…
              </div>
            )}

            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 flex-1 break-words">
                  <div className="font-medium">Something went wrong</div>
                  <div className="text-xs opacity-80">{error.message}</div>
                </div>
                <button
                  type="button"
                  disabled={!ready}
                  onClick={() => regenerate()}
                  className="shrink-0 rounded-md border border-destructive/40 px-2 py-1 text-xs hover:bg-destructive/20"
                >
                  Retry
                </button>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>
        <MessageRail
          scrollRef={scrollRef}
          messages={messages}
          onNavigate={() => {
            holdAutoScroll.current = true;
            window.clearTimeout(holdTimer.current);
            holdTimer.current = window.setTimeout(() => {
              holdAutoScroll.current = false;
            }, 700);
          }}
          onBranch={
            branchAt
              ? (id) => {
                  const index = messageIndexById(messages, id);
                  if (index >= 0) branchAt(index);
                }
              : undefined
          }
        />
      </div>

      <div className="shrink-0 border-t border-border bg-background">
        <div className="mx-auto max-w-3xl px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-8">
          <PromptInput value={draft} onValueChange={setDraft} inputRef={promptRef} busy={busy} disabled={!ready} inputs={chatInputs} onSend={(text, files) => sendMessage({ text, ...(files.length ? { files } : {}) })} onStop={stop} />
        </div>
      </div>
    </>
  );
}
