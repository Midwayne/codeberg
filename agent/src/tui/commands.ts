import type { ModelMessage } from "ai";

import { messageText } from "../core/message.js";
import type { SessionSummary } from "./session-store.js";

/** A parsed slash command. `arg` is the trimmed remainder (e.g. a session id). */
export type Command =
  | { kind: "help" }
  | { kind: "sessions" }
  | { kind: "resume"; arg: string }
  | { kind: "new" };

/** User-facing catalogue, also rendered by `/help`. */
export const COMMANDS: ReadonlyArray<{ usage: string; summary: string }> = [
  { usage: "/help", summary: "show this list of commands" },
  { usage: "/sessions", summary: "list saved chats you can resume" },
  { usage: "/resume <id>", summary: "resume a saved chat by id" },
  { usage: "/new", summary: "start a fresh chat (clears context)" },
];

/**
 * Recognise a typed slash command. Only the exact verbs below (plus a bare `/`)
 * are intercepted; anything else starting with `/` — a path like `/etc/hosts`,
 * an unknown verb — is left alone and sent to the model as an ordinary message.
 */
export function parseCommand(text: string): Command | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  if (trimmed === "/") {
    return { kind: "help" };
  }

  const [verb, ...rest] = trimmed.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();
  switch (verb!.toLowerCase()) {
    case "help":
    case "?":
      return { kind: "help" };
    case "sessions":
    case "list":
      return { kind: "sessions" };
    case "resume":
    case "continue":
      return { kind: "resume", arg };
    case "new":
    case "clear":
      return { kind: "new" };
    default:
      return null;
  }
}

/**
 * Drop slash-command exchanges from a transcript so they never reach the model.
 * A command is a user message that `parseCommand` recognises; its synthetic
 * reply is the assistant message that immediately follows.
 */
export function stripCommandTurns(messages: ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    if (message.role === "user" && parseCommand(messageText(message))) {
      if (messages[i + 1]?.role === "assistant") {
        i++; // also skip the synthetic reply
      }
      continue;
    }
    out.push(message);
  }
  return out;
}

export function formatHelp(): string {
  const width = Math.max(...COMMANDS.map((c) => c.usage.length));
  const lines = COMMANDS.map(
    (c) => `  ${c.usage.padEnd(width)}  ${c.summary}`,
  );
  return ["Commands:", ...lines].join("\n");
}

export function formatSessionList(
  sessions: SessionSummary[],
  now: number = Date.now(),
): string {
  if (sessions.length === 0) {
    return "No saved sessions yet. Ask a question to start one.";
  }
  const idWidth = Math.max(...sessions.map((s) => s.id.length));
  const lines = sessions.map((s) => {
    const turns = `${s.turns} turn${s.turns === 1 ? "" : "s"}`;
    return `  ${s.id.padEnd(idWidth)}  ${quote(s.title)}  ·  ${relativeTime(
      s.updatedAt,
      now,
    )}  ·  ${turns}`;
  });
  return [
    "Saved sessions (most recent first):",
    "",
    ...lines,
    "",
    "Type /resume <id> to continue one.",
  ].join("\n");
}

function quote(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  const short = clean.length > 48 ? `${clean.slice(0, 47)}…` : clean;
  return `"${short || "(untitled)"}"`;
}

/** Compact relative age: "just now", "5m ago", "2h ago", "3d ago", else date. */
export function relativeTime(then: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 45) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return new Date(then).toISOString().slice(0, 10);
}

/** First user message, condensed to a one-line session title. */
export function deriveTitle(messages: ModelMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  const text = firstUser ? messageText(firstUser).replace(/\s+/g, " ").trim() : "";
  if (!text) {
    return "(untitled)";
  }
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}
