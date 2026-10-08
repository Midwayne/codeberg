import type { Chat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';

export type TurnInput = { text: string; files?: FileList };
export type QueuedTurn = TurnInput & { id: string };
export type QueueSnapshot = { items: QueuedTurn[]; paused: boolean; steering: boolean; error?: string };

export const EMPTY_QUEUE: QueueSnapshot = { items: [], paused: false, steering: false };

/** Owned by the session, so switching chats never transfers or loses pending prompts. */
export class TurnQueue {
  private snapshot: QueueSnapshot = EMPTY_QUEUE;
  private listeners = new Set<() => void>();
  private active?: Promise<void>;
  private disposed = false;
  private intent = 0;

  constructor(private chat: Pick<Chat<UIMessage>, 'sendMessage' | 'stop' | 'regenerate' | 'status'>) {}

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  submit = (input: TurnInput) => {
    if (this.disposed || (!input.text.trim() && !input.files?.length)) return;

    const item = { ...input, id: crypto.randomUUID() };
    this.update({ items: [...this.snapshot.items, item] });
    this.drain();
  };

  remove = (id: string) => {
    this.update({ items: this.snapshot.items.filter((item) => item.id !== id) });
  };

  resume = () => {
    if (this.chat.status === 'error') return;

    this.update({ paused: false, error: undefined });
    this.drain();
  };

  stop = async () => {
    this.intent++;
    this.update({ paused: true, steering: false });
    await this.chat.stop();
    await this.active;
  };

  steer = async (input: TurnInput) => {
    if (this.disposed || this.snapshot.steering || (!input.text.trim() && !input.files?.length)) return;

    const intent = ++this.intent;
    const item = { ...input, id: crypto.randomUUID() };
    this.update({ paused: true, steering: true, items: [item, ...this.snapshot.items] });
    await this.chat.stop();
    await this.active;
    if (this.disposed || intent !== this.intent) return;

    this.update({ paused: false, steering: false, error: undefined,
      items: this.snapshot.items.filter((pending) => pending.id !== item.id) });
    this.start(() => this.chat.sendMessage(input), item);
  };

  steerQueued = (id: string) => {
    const item = this.snapshot.items.find((item) => item.id === id);
    if (!item || this.snapshot.steering) return;

    this.remove(id);
    void this.steer(item);
  };

  retry = () => {
    if (this.disposed || this.active) return;

    this.update({ paused: false, error: undefined });
    this.start(() => this.chat.regenerate());
  };

  dispose = () => {
    this.disposed = true;
    this.intent++;
    this.update({ items: [], paused: true, steering: false });
    void this.chat.stop();
  };

  private update(patch: Partial<QueueSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private drain() {
    if (this.disposed || this.active || this.snapshot.paused || this.snapshot.steering) return;
    if (this.chat.status === 'submitted' || this.chat.status === 'streaming' || this.chat.status === 'error') return;

    const item = this.snapshot.items[0];
    if (!item) return;

    this.update({ items: this.snapshot.items.slice(1) });
    this.start(() => this.chat.sendMessage(item), item);
  }

  private start(action: () => Promise<void>, item?: QueuedTurn) {
    this.active = this.run(action, item);
  }

  private async run(action: () => Promise<void>, item?: QueuedTurn) {
    try {
      await action();
      if (this.chat.status === 'error') this.update({ paused: true });
    } catch (error) {
      this.update({ paused: true, error: error instanceof Error ? error.message : 'Unable to send this follow-up.',
        ...(item && !this.disposed ? { items: [item, ...this.snapshot.items] } : {}) });
    } finally {
      this.active = undefined;
      this.drain();
    }
  }
}
