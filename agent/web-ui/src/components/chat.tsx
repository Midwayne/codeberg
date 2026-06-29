import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";

import { Message } from "@/components/message";
import { PromptInput } from "@/components/prompt-input";

// `useChat` lives in the parent `Workspace` (which also owns session state), so
// `Chat` is presentational over the helpers it returns.
export function Chat({ chat }: { chat: UseChatHelpers<UIMessage> }) {
  const { messages, sendMessage, status, stop, regenerate, error } = chat;
  const busy = status === "submitted" || status === "streaming";

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Keep the view pinned to the latest content unless the user has scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

  return (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
          {messages.length === 0 && <Empty />}

          {messages.map((m, i) => (
            <Message
              key={m.id}
              message={m}
              onRegenerate={
                !busy && m.role === "assistant" && i === messages.length - 1
                  ? () => regenerate()
                  : undefined
              }
            />
          ))}

          {status === "submitted" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Thinking…
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div className="flex-1">
                <div className="font-medium">Something went wrong</div>
                <div className="text-xs opacity-80">{error.message}</div>
              </div>
              <button
                type="button"
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

      <div className="shrink-0 border-t border-border bg-background">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <PromptInput
            busy={busy}
            onSend={(text) => sendMessage({ text })}
            onStop={stop}
          />
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Enter to send · Shift+Enter for newline
          </p>
        </div>
      </div>
    </>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center gap-2 py-24 text-center">
      <h1 className="text-lg font-medium">Ask about the codebase</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Semantic code search with citations. Try “How is authentication
        handled?” or “Where is the main entry point?”
      </p>
    </div>
  );
}
