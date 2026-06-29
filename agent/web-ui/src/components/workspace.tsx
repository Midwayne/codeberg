import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Chat } from "@/components/chat";
import { SessionSidebar } from "@/components/session-sidebar";
import { useSessions } from "@/lib/use-sessions";
import {
  deleteSession,
  deriveTitle,
  loadSession,
  newSessionId,
  saveSession,
} from "@/lib/sessions";

/**
 * Owns the chat and its persistence. `useChat` lives here (not in `Chat`) so the
 * sidebar can drive it: resuming a saved chat replaces the messages, "New chat"
 * clears them. Each completed turn is written back to the server keyed by the
 * current session id, so the conversation survives reloads and is resumable.
 */
export function Workspace({ sidebarOpen }: { sidebarOpen: boolean }) {
  const chat = useChat();
  const { sessions, refresh } = useSessions();
  const [sessionId, setSessionId] = useState(newSessionId);

  // Signature of the last conversation we persisted, so the save effect skips
  // re-writing an unchanged turn (notably the one we just resumed).
  const savedSig = useRef("");
  const signature = (id: string, msgs: { id: string }[]) =>
    `${id}:${msgs.length}:${msgs.at(-1)?.id ?? ""}`;

  // Persist once a turn settles (status back to "ready") and there's something
  // to save. PUT is idempotent, so the dedupe is just to avoid needless writes.
  useEffect(() => {
    if (chat.status !== "ready" || chat.messages.length === 0) return;
    const sig = signature(sessionId, chat.messages);
    if (sig === savedSig.current) return;
    savedSig.current = sig;
    void saveSession({
      id: sessionId,
      title: deriveTitle(chat.messages),
      messages: chat.messages,
    }).then(refresh);
  }, [chat.status, chat.messages, sessionId, refresh]);

  const resume = useCallback(
    async (id: string) => {
      const record = await loadSession(id);
      if (!record) {
        void refresh(); // it was deleted out from under us
        return;
      }
      chat.setMessages(record.messages);
      setSessionId(record.id);
      savedSig.current = signature(record.id, record.messages);
    },
    [chat, refresh],
  );

  const startNew = useCallback(() => {
    chat.setMessages([]);
    setSessionId(newSessionId());
    savedSig.current = "";
  }, [chat]);

  const remove = useCallback(
    async (id: string) => {
      await deleteSession(id);
      if (id === sessionId) startNew();
      void refresh();
    },
    [sessionId, startNew, refresh],
  );

  return (
    <div className="flex min-h-0 flex-1">
      {sidebarOpen && (
        <SessionSidebar
          sessions={sessions}
          currentId={sessionId}
          onResume={resume}
          onNew={startNew}
          onDelete={remove}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Chat chat={chat} />
      </div>
    </div>
  );
}
