export type ChatSaveSnapshot = { error?: string; retrying: boolean };

/** A failed disk/network save stays visible independently of model generation. */
export class ChatSaveState {
  private snapshot: ChatSaveSnapshot = { retrying: false };
  private listeners = new Set<() => void>();

  constructor(private saveLatest: () => Promise<void>) {}

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  saved = () => {
    this.update({ retrying: this.snapshot.retrying });
  };

  failed = (error: unknown) => {
    this.update({ retrying: this.snapshot.retrying, error: error instanceof Error ? error.message : 'Chat storage is unavailable.' });
  };

  retry = async () => {
    if (this.snapshot.retrying) return;

    this.update({ ...this.snapshot, retrying: true });
    try {
      await this.saveLatest();
    } catch (error) {
      this.failed(error);
    } finally {
      this.update({ ...this.snapshot, retrying: false });
    }
  };

  private update(snapshot: ChatSaveSnapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
}
