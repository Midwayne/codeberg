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

  constructor(value: ModelSelection | null = null, onServer = false, private readonly persist?: PersistModel) {
    this.value = value;
    this.onServer = onServer;
    this.unsaved = !onServer && value !== null;
  }

  get current(): ModelSelection | null {
    return this.value;
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

    this.unsaved = false;
    void this.store(this.value, this.value).catch(() => {
      this.unsaved = true;
    });
  }

  /** A saved record replaces the choice unless a change of this tab is still being saved. */
  restore(saved: ModelSelection | null): void {
    if (this.saving > 0 || this.unsaved) return;

    this.set(saved);
  }

  private async store(next: ModelSelection | null, previous: ModelSelection | null): Promise<void> {
    this.saving++;
    try {
      await this.persist?.(next);
    } catch (error) {
      if (sameChoice(this.value, next)) this.set(previous);

      throw error;
    } finally {
      this.saving--;
    }
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
