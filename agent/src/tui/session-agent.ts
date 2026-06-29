import type { ModelMessage, ToolLoopAgent } from "ai";

import {
  type Command,
  deriveTitle,
  formatHelp,
  formatSessionList,
  parseCommand,
  stripCommandTurns,
  textOf,
} from "./commands.js";
import { SessionStore } from "./session-store.js";

export interface SessionAgentOptions {
  store: SessionStore;
  /** Recorded on each session for display; not used to drive the model. */
  modelSpec: string;
  /** Injectable clock/id for deterministic tests. */
  now?: () => number;
  newId?: () => string;
}

type StreamParams = Parameters<ToolLoopAgent["stream"]>[0];
type StreamResult = Awaited<ReturnType<ToolLoopAgent["stream"]>>;

/**
 * Wrap a `ToolLoopAgent` so the sealed `runAgentTUI` gains persistent,
 * resumable sessions and typed slash commands — without forking the TUI.
 *
 * The runner calls `agent.stream({ prompt })` every turn with the full
 * transcript, and only reads `result.fullStream`. That is the one seam we
 * control, so this proxy:
 *
 *  - rewrites `prompt` before it reaches the model — stripping slash-command
 *    turns, prepending a resumed session's history, and honouring `/new`;
 *  - short-circuits a typed command (`/help`, `/sessions`, `/resume`, `/new`)
 *    with a synthetic text stream instead of calling the model;
 *  - tees real responses to disk so every chat is saved and can be resumed.
 *
 * The TUI's own scrollback is untouched; we only change what the model sees
 * and what we persist.
 */
export function wrapSessionAgent(
  loop: ToolLoopAgent,
  opts: SessionAgentOptions,
): ToolLoopAgent {
  const now = opts.now ?? (() => Date.now());
  const newId = opts.newId ?? SessionStore.newId;

  const state = {
    sessionId: newId(),
    /** History prepended to every turn after a `/resume`. */
    resumed: [] as ModelMessage[],
    /**
     * Index into the runner's append-only transcript before which messages are
     * ignored. Bumped past a `/new` or `/resume` command (and the synthetic
     * reply the runner appends right after) so earlier on-screen turns drop out
     * of model context.
     */
    dropBefore: 0,
    title: undefined as string | undefined,
    createdAt: now(),
  };

  async function runCommand(command: Command, raw: ModelMessage[]): Promise<string> {
    switch (command.kind) {
      case "help":
        return formatHelp();

      case "sessions":
        return formatSessionList(await opts.store.list(), now());

      case "new":
        state.sessionId = newId();
        state.resumed = [];
        state.title = undefined;
        state.createdAt = now();
        state.dropBefore = raw.length + 1; // skip this command and its reply
        return "Started a fresh session. Earlier turns are no longer in context.";

      case "resume": {
        if (!command.arg) {
          return "Usage: /resume <id>. Run /sessions to see saved ids.";
        }
        const record = await opts.store.resolve(command.arg);
        if (!record) {
          return `No session matches "${command.arg}". Run /sessions to see saved ids.`;
        }
        state.sessionId = record.id;
        state.resumed = stripCommandTurns(record.messages);
        state.title = record.title;
        state.createdAt = record.createdAt;
        state.dropBefore = raw.length + 1;
        const turns = state.resumed.filter((m) => m.role === "user").length;
        return `Resumed "${record.title}" — ${turns} prior turn${
          turns === 1 ? "" : "s"
        } now in context.`;
      }
    }
  }

  async function persist(messages: ModelMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }
    state.title ??= deriveTitle(messages);
    try {
      await opts.store.save({
        id: state.sessionId,
        title: state.title,
        modelSpec: opts.modelSpec,
        createdAt: state.createdAt,
        updatedAt: now(),
        messages,
      });
    } catch {
      // Best-effort: a write failure must never break the live chat.
    }
  }

  const streamOverride = async (params: StreamParams): Promise<StreamResult> => {
    const raw = toModelMessages(params.prompt);
    const last = lastUserMessage(raw);
    const command = last ? parseCommand(textOf(last)) : null;
    if (command) {
      return synthetic(await runCommand(command, raw));
    }

    const current = stripCommandTurns(raw.slice(state.dropBefore));
    const effective = [...state.resumed, ...current];
    // The runner always calls us with the `prompt` form of the params union;
    // swap in our rewritten history (the cast re-narrows that union).
    const result = await loop.stream({
      ...params,
      prompt: effective,
    } as StreamParams);
    return teeForPersistence(result, effective, persist);
  };

  return new Proxy(loop, {
    get(target, prop) {
      if (prop === "stream") {
        return streamOverride;
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as ToolLoopAgent;
}

function toModelMessages(prompt: unknown): ModelMessage[] {
  return Array.isArray(prompt) ? (prompt as ModelMessage[]) : [];
}

function lastUserMessage(messages: ModelMessage[]): ModelMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      return messages[i];
    }
  }
  return undefined;
}

/**
 * A minimal `fullStream` carrying a single assistant text block. The runner
 * only consumes `result.fullStream`, so this is all it needs to render a
 * command's reply as an assistant turn — no model call involved.
 */
function synthetic(text: string): StreamResult {
  async function* fullStream(): AsyncGenerator<unknown> {
    const id = "codeberg-command";
    yield { type: "text-start", id };
    yield { type: "text-delta", id, text };
    yield { type: "text-end", id };
    yield { type: "finish", finishReason: "stop", totalUsage: undefined };
  }
  return { fullStream: fullStream() } as unknown as StreamResult;
}

/**
 * Pass the model's stream through unchanged while accumulating its text, then
 * persist the turn once the stream ends (including on abort, via `finally`).
 */
function teeForPersistence(
  result: StreamResult,
  effective: ModelMessage[],
  persist: (messages: ModelMessage[]) => Promise<void>,
): StreamResult {
  const source = result.fullStream as AsyncIterable<{
    type?: string;
    text?: string;
  }>;

  async function* observed(): AsyncGenerator<unknown> {
    let text = "";
    try {
      for await (const part of source) {
        if (part?.type === "text-delta" && typeof part.text === "string") {
          text += part.text;
        }
        yield part;
      }
    } finally {
      const messages = text
        ? [...effective, { role: "assistant", content: text } as ModelMessage]
        : effective;
      // Awaited within the generator's completion, so the turn is on disk
      // before the stream reports done (`persist` swallows its own errors).
      await persist(messages);
    }
  }

  const stream = observed();
  return new Proxy(result as object, {
    get(target, prop) {
      if (prop === "fullStream") {
        return stream;
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as StreamResult;
}
