import type { ChatTransport, UIMessage } from 'ai';

import type { ModelSelection } from '../lib/models';

type PersistModel = (model: ModelSelection | null) => Promise<void>;

/**
 * One chat's own model; `null` follows the default chat model from Models.
 *
 * A chat the server has saves a change with its own request, never with message
 * saves, so another tab's stale copy cannot overwrite it. A chat the server does
 * not have yet hands its choice to the next message save instead.
 */
export class ChatModelChoice {
  private value: ModelSelection | null;
  private listeners = new Set<() => void>();
  private onServer: boolean;
  private unsaved: boolean;
  private saving = 0;
  private queue: Promise<void> = Promise.resolve();
  private failure = '';

  constructor(value: ModelSelection | null = null, onServer = false, private readonly persist?: PersistModel) {
    this.value = value;
    this.onServer = onServer;
    this.unsaved = !onServer && value !== null;
  }

  get current(): ModelSelection | null {
    return this.value;
  }

  /** Why the last background save of the choice failed; empty once one succeeds. */
  get error(): string {
    return this.failure;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Choose this chat's model; a failed save restores the previous choice and rethrows. */
  async choose(next: ModelSelection | null): Promise<void> {
    const previous = this.value;
    if (sameChoice(previous, next)) return;

    this.set(next);
    if (!this.onServer) {
      this.unsaved = true;

      return;
    }

    await this.store(next, previous);
  }

  /** The model a message save carries: only a choice the server has not stored yet. */
  forMessageSave(): ModelSelection | null | undefined {
    return this.unsaved ? this.value : undefined;
  }

  /** A message save reached the server; a choice made while it was in flight is sent on its own. */
  messageSaved(carried: ModelSelection | null | undefined): void {
    this.onServer = true;
    if (!this.unsaved) return;

    if (carried !== undefined && sameChoice(carried, this.value)) {
      this.unsaved = false;

      return;
    }

    // A failed save keeps the choice for the next message save and says so in the composer.
    this.unsaved = false;
    void this.store(this.value, this.value).catch((error: unknown) => {
      this.unsaved = true;
      this.fail(error instanceof Error ? error.message : "Could not save the chat's model.");
    });
  }

  /** A saved record replaces the choice unless a change of this tab is still being saved. */
  restore(saved: ModelSelection | null): void {
    if (this.saving > 0 || this.unsaved) return;

    this.set(saved);
  }

  /** Saves run one at a time, so the server always ends with the latest choice. */
  private store(next: ModelSelection | null, previous: ModelSelection | null): Promise<void> {
    this.saving++;

    const stored = this.queue.then(() => this.persist?.(next));
    this.queue = stored.then(() => undefined, () => undefined);

    return stored.then(
      () => {
        this.saving--;
        this.fail('');
      },
      (error: unknown) => {
        this.saving--;
        if (sameChoice(this.value, next)) this.set(previous);

        throw error;
      },
    );
  }

  private fail(message: string): void {
    if (this.failure === message) return;

    this.failure = message;
    this.listeners.forEach((listener) => listener());
  }

  private set(value: ModelSelection | null): void {
    if (sameChoice(this.value, value)) return;

    this.value = value;
    this.listeners.forEach((listener) => listener());
  }
}

function sameChoice(a: ModelSelection | null, b: ModelSelection | null): boolean {
  return a?.key === b?.key && a?.effort === b?.effort;
}

/** Each request names the chat's own model, read when the message is sent. */
export function chatModelTransport(
  transport: ChatTransport<UIMessage>,
  choice: ChatModelChoice,
): ChatTransport<UIMessage> {
  return {
    sendMessages: (request) => {
      const model = choice.current;
      const body = model ? { ...request.body, model } : request.body;

      return transport.sendMessages({ ...request, body });
    },
    reconnectToStream: (request) => transport.reconnectToStream(request),
  };
}
