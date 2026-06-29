import { MessageSquarePlus, Trash2 } from "lucide-react";

import type { SessionSummary } from "@/lib/sessions";
import { cn, timeAgo } from "@/lib/utils";

/**
 * The saved-chats panel: a "New chat" button over a newest-first list. Clicking
 * a row resumes that chat; the current one is highlighted; each row has a
 * hover-revealed delete. Toggled in/out of the layout by the header button.
 */
export function SessionSidebar({
  sessions,
  currentId,
  onResume,
  onNew,
  onDelete,
}: {
  sessions: SessionSummary[];
  currentId: string;
  onResume: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card/30">
      <div className="p-2">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
        >
          <MessageSquarePlus className="size-4" />
          New chat
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {sessions.length === 0 ? (
          <p className="px-2 py-4 text-xs text-muted-foreground">
            No saved chats yet. They appear here after your first message.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((s) => (
              <li key={s.id}>
                <div
                  className={cn(
                    "group/sess flex items-center gap-1 rounded-md pr-1 text-xs transition-colors hover:bg-accent",
                    s.id === currentId && "bg-accent",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onResume(s.id)}
                    className="min-w-0 flex-1 px-2 py-1.5 text-left"
                    title={s.title}
                  >
                    <div className="truncate text-foreground">{s.title}</div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {timeAgo(s.updatedAt)} · {s.turns} turn{s.turns === 1 ? "" : "s"}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(s.id)}
                    aria-label="Delete chat"
                    title="Delete chat"
                    className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/sess:opacity-100 focus-visible:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
