import { ArrowUp, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const MAX_HEIGHT = 200;

/**
 * Auto-growing composer. Enter sends, Shift+Enter inserts a newline. The action
 * button becomes a stop control while a turn is streaming.
 */
export function PromptInput({
  busy,
  onSend,
  onStop,
}: {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  function submit() {
    const text = value.trim();
    if (!text || busy) return;
    onSend(text);
    setValue("");
  }

  return (
    <div className="flex items-end gap-2 rounded-2xl border border-input bg-card p-2 shadow-sm transition-colors focus-within:border-ring">
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Ask about the codebase…"
        className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
      />
      {busy ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop"
          title="Stop"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Square className="size-3.5 fill-current" />
        </button>
      ) : (
        <button
          type="button"
          onClick={submit}
          disabled={!value.trim()}
          aria-label="Send"
          title="Send"
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity",
            "hover:opacity-90 disabled:opacity-30",
          )}
        >
          <ArrowUp className="size-4" />
        </button>
      )}
    </div>
  );
}
