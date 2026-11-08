import { createHash } from 'node:crypto';
import { abortControlled, SHUTDOWN_REQUEST, STOP_REQUEST } from '../runs/identity.js';
import { backgroundSummary, type BackgroundJob, type BackgroundOwner, type BackgroundStart,
  type BackgroundExecute, type RetainBackground, type ReleaseBackground } from '../../core/background/types.js';
import { executeBackground, onceRelease } from './execution.js';
import { BackgroundError, BackgroundStore } from './store.js';

type ActiveJob = { job: BackgroundJob; controller: AbortController; done: Promise<void>; release: ReleaseBackground };

/** Calls run once while this process lives. Recovery never repeats uncertain effects. */
export class BackgroundJobs {
  readonly store: BackgroundStore;
  private readonly active = new Map<string, ActiveJob>();
  private initializing?: Promise<void>;
  private closed = false;

  constructor(directory: string) {
    this.store = new BackgroundStore(directory);
  }

  get busy(): boolean {
    return this.active.size > 0 || this.store.busy;
  }

  hasActive(chatId: string): boolean {
    return [...this.active.values()].some((entry) => entry.job.chatId === chatId);
  }

  initialize(): Promise<void> {
    this.initializing ??= this.recover();

    return this.initializing;
  }

  async start(owner: BackgroundOwner, input: BackgroundStart, execute: BackgroundExecute, retain?: RetainBackground) {
    await this.initialize();

    return this.store.serial(async () => {
      if (this.closed) throw new BackgroundError(503, 'Background tools are stopping.');

      const id = createHash('sha256').update(`${owner.chatId}:${owner.sourceRunId}:${input.callId}`).digest('hex').slice(0, 32);
      const fingerprint = JSON.stringify([input.tool, input.args]);
      const existing = await this.store.read(owner.chatId, id);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new BackgroundError(409, 'Tool call ID reused with different arguments.');

        return backgroundSummary(existing);
      }
      if (this.active.size >= 32 || [...this.active.values()].filter((entry) => entry.job.chatId === owner.chatId).length >= 8) {
        throw new BackgroundError(409, 'Background tool limit reached (8 per chat, 32 per project). Wait or cancel an active job.');
      }

      const job: BackgroundJob = { chatId: owner.chatId, sourceRunId: owner.sourceRunId, id, fingerprint, tool: input.tool, args: structuredClone(input.args), status: 'running', createdAt: Date.now() };
      const release = onceRelease(retain?.());
      try {
        await this.store.write(job);
      } catch (error) {
        await release();
        throw error;
      }

      const entry: ActiveJob = { job, controller: new AbortController(), done: Promise.resolve(), release };
      this.active.set(id, entry);
      entry.done = executeBackground(job, execute, entry.controller.signal, this.store, () => this.closed, release)
        .catch((error) => console.error('Background tool persistence failed:', error))
        .finally(() => this.active.delete(id));

      return backgroundSummary(job);
    });
  }

  async get(chatId: string, id: string): Promise<BackgroundJob> {
    await this.initialize();
    const job = await this.store.read(chatId, id);
    if (!job) throw new BackgroundError(404, 'Background job not found in this chat.');

    return job;
  }

  async list(chatId: string) {
    return (await this.listAll()).filter((job) => job.chatId === chatId);
  }

  async listAll() {
    await this.initialize();

    return (await this.store.all()).map(backgroundSummary);
  }

  async cancel(chatId: string, id: string): Promise<BackgroundJob> {
    await this.initialize();

    return this.store.serial(async () => {
      const job = await this.get(chatId, id);
      const entry = this.active.get(id);
      if (!entry || !['running', 'cancelling'].includes(job.status)) return job;

      abortControlled(entry.controller, STOP_REQUEST);
      job.status = 'cancelling';
      entry.job.status = 'cancelling';
      await this.store.write(job);

      return job;
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.initializing;
    const active = [...this.active.values()];
    for (const entry of active) abortControlled(entry.controller, SHUTDOWN_REQUEST);

    await this.store.serial(async () => {
      for (const entry of active) {
        if (['running', 'cancelling'].includes(entry.job.status)) await this.interrupt(entry.job);
      }
    });
    await Promise.allSettled(active.map((entry) => entry.release()));
    this.active.clear();
  }

  private async recover(): Promise<void> {
    for (const job of await this.store.all()) {
      if (['running', 'cancelling'].includes(job.status)) await this.interrupt(job);
    }
  }

  private async interrupt(job: BackgroundJob): Promise<void> {
    job.status = 'interrupted';
    job.error = 'Codeberg stopped. This tool outcome is uncertain; it will not be called again automatically.';
    job.finishedAt = Date.now();
    await this.store.write(job);
  }
}
