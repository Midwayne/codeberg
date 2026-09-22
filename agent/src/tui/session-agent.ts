import type { ModelMessage, ToolLoopAgent } from 'ai';

import { branchTitle, branchTranscript } from '../core/branch.js';
import { overrideLoopMethods } from '../core/loop.js';
import { lastUserMessage, messageText } from '../core/message.js';
import {
  type Command,
  deriveTitle,
  formatHelp,
  formatSessionList,
  parseCommand,
  stripCommandTurns,
} from './commands.js';
import { SessionStore, type SessionRecord } from './session-store.js';

export interface SessionAgentOptions {
  store: SessionStore;
  /** Recorded on each session for display; not used to drive the model. */
  modelSpec: string;
  /** Compacts the transcript to fit the model's context window before it's sent
   *  (the full transcript is still persisted for resume). Optional: without it
   *  the transcript is sent as-is, the prior behaviour. */
  compactor?: (messages: ModelMessage[]) => Promise<ModelMessage[]>;
  /** Injectable clock/id for deterministic tests. */
  now?: () => number;
  newId?: () => string;
}

type StreamParams = Parameters<ToolLoopAgent['stream']>[0];
type StreamResult = Awaited<ReturnType<ToolLoopAgent['stream']>>;

/** The live chat. Commands replace the whole value; they never patch one field. */
interface LiveSession {
  sessionId: string;
  /** History prepended to every turn after a `/resume` or `/branch`. */
  resumed: ModelMessage[];
  /**
   * Index into the runner's append-only transcript before which messages are
   * ignored. A `/new`, `/resume`, or `/branch` sets this past the command and
   * the synthetic reply the runner appends right after, so earlier on-screen
   * turns drop out of model context.
   */
  dropBefore: number;
  title: string | undefined;
  createdAt: number;
  parentId: string | undefined;
}

function openSession(sessionId: string, createdAt: number, dropBefore: number): LiveSession {
  return {
    sessionId,
    resumed: [],
    dropBefore,
    title: undefined,
    createdAt,
    parentId: undefined,
  };
}

function resumeSession(record: SessionRecord, dropBefore: number): LiveSession {
  return {
    sessionId: record.id,
    resumed: stripCommandTurns(record.messages),
    dropBefore,
    title: record.title,
    createdAt: record.createdAt,
    parentId: record.parentId,
  };
}

function branchSession(
  prev: LiveSession,
  seed: ModelMessage[],
  sessionId: string,
  createdAt: number,
  dropBefore: number,
): LiveSession {
  return {
    sessionId,
    resumed: seed,
    dropBefore,
    title: branchTitle(prev.title ?? deriveTitle(seed)),
    createdAt,
    parentId: prev.sessionId,
  };
}

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
 *  - short-circuits a typed command (`/help`, `/sessions`, `/resume`, `/new`,
 *    `/branch`) with a synthetic text stream instead of calling the model;
 *  - tees real responses to disk so every chat is saved and can be resumed.
 *
 * The TUI's own scrollback is untouched; we only change what the model sees
 * and what we persist.
 */
export function wrapSessionAgent(loop: ToolLoopAgent, opts: SessionAgentOptions): ToolLoopAgent {
  const now = opts.now ?? (() => Date.now());
  const newId = opts.newId ?? SessionStore.newId;

  let session = openSession(newId(), now(), 0);

  async function runCommand(command: Command, raw: ModelMessage[]): Promise<string> {
    // The command and the synthetic reply the runner appends next both leave
    // model context. Help and sessions do not touch the live session.
    const dropBefore = raw.length + 1;
    switch (command.kind) {
      case 'help':
        return formatHelp();

      case 'sessions':
        return formatSessionList(await opts.store.list(), now());

      case 'new':
        session = openSession(newId(), now(), dropBefore);
        return 'Started a fresh session. Earlier turns are no longer in context.';

      case 'resume': {
        if (!command.arg) {
          return 'Usage: /resume <id>. Run /sessions to see saved ids.';
        }
        const record = await opts.store.resolve(command.arg);
        if (!record) {
          return `No session matches "${command.arg}". Run /sessions to see saved ids.`;
        }
        session = resumeSession(record, dropBefore);
        const turns = session.resumed.filter((m) => m.role === 'user').length;
        return `Resumed "${record.title}" — ${turns} prior turn${
          turns === 1 ? '' : 's'
        } now in context.`;
      }

      case 'branch': {
        const seed = branchTranscript([
          ...session.resumed,
          ...stripCommandTurns(raw.slice(session.dropBefore)),
        ]);
        if (seed.length === 0) {
          return 'Nothing to branch — ask a question first.';
        }
        const parentId = session.sessionId;
        session = branchSession(session, seed, newId(), now(), dropBefore);
        await persist(seed);
        const turns = seed.filter((m) => m.role === 'user').length;
        return `Branched into ${session.sessionId} — ${turns} prior turn${
          turns === 1 ? '' : 's'
        } copied. Resume ${parentId} to return to the original.`;
      }

      default: {
        const _never: never = command;
        throw new Error(`unexpected command: ${JSON.stringify(_never)}`);
      }
    }
  }

  async function persist(messages: ModelMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }
    const title = session.title ?? deriveTitle(messages);
    session = { ...session, title };
    try {
      await opts.store.save({
        id: session.sessionId,
        title,
        modelSpec: opts.modelSpec,
        createdAt: session.createdAt,
        updatedAt: now(),
        messages,
        parentId: session.parentId,
      });
    } catch {
      // Best-effort: a write failure must never break the live chat.
    }
  }

  const streamOverride = async (params: StreamParams): Promise<StreamResult> => {
    const raw = toModelMessages(params.prompt);
    const last = lastUserMessage(raw);
    const command = last ? parseCommand(messageText(last)) : null;
    if (command) {
      return synthetic(await runCommand(command, raw));
    }

    const current = stripCommandTurns(raw.slice(session.dropBefore));
    const effective = [...session.resumed, ...current];
    // Send a budgeted view to the model (older turns summarized once they
    // exceed the window), but persist the full transcript so resume is lossless.
    const sent = opts.compactor ? await opts.compactor(effective) : effective;
    // The runner always calls us with the `prompt` form of the params union;
    // swap in our rewritten history (the cast re-narrows that union).
    const result = await loop.stream({
      ...params,
      prompt: sent,
    } as StreamParams);
    return teeForPersistence(result, effective, persist);
  };

  return overrideLoopMethods(loop, { stream: streamOverride });
}

function toModelMessages(prompt: unknown): ModelMessage[] {
  return Array.isArray(prompt) ? (prompt as ModelMessage[]) : [];
}

/**
 * A minimal `fullStream` carrying a single assistant text block. The runner
 * only consumes `result.fullStream`, so this is all it needs to render a
 * command's reply as an assistant turn — no model call involved.
 */
function synthetic(text: string): StreamResult {
  async function* fullStream(): AsyncGenerator<unknown> {
    const id = 'codeberg-command';
    yield { type: 'text-start', id };
    yield { type: 'text-delta', id, text };
    yield { type: 'text-end', id };
    yield { type: 'finish', finishReason: 'stop', totalUsage: undefined };
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
    let text = '';
    try {
      for await (const part of source) {
        if (part?.type === 'text-delta' && typeof part.text === 'string') {
          text += part.text;
        }
        yield part;
      }
    } finally {
      const messages = text
        ? [...effective, { role: 'assistant', content: text } as ModelMessage]
        : effective;
      // Awaited within the generator's completion, so the turn is on disk
      // before the stream reports done (`persist` swallows its own errors).
      await persist(messages);
    }
  }

  const stream = observed();
  return new Proxy(result as object, {
    get(target, prop) {
      if (prop === 'fullStream') {
        return stream;
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as StreamResult;
}
