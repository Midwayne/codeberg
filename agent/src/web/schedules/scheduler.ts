import { reserveSchedule } from './history.js';
import type { ScheduleInput } from '../../core/schedules/context.js';
import type { SearchRuns } from '../runs/manager.js';
import { admitScheduled, readyPrompt, settleSchedule } from './dispatch.js';
import { ScheduleStore } from './store.js';
import { requestId, type ScheduledRun, type ScheduleOwner } from './types.js';
import { newSchedule } from './validation.js';

/** Durable wake-ups owned by one project runtime, independent of browser subscriptions. */
export class RunScheduler {
  readonly store: ScheduleStore;
  canDispatch = () => true;
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  private ticking?: Promise<void>;

  constructor(private readonly runs: SearchRuns) {
    this.store = new ScheduleStore(runs.sessions.dir);
  }

  get busy(): boolean {
    return this.store.busy;
  }

  start(): void {
    if (this.timer || this.closed) return;

    this.timer = setInterval(() => {
      void this.tick().catch((error) => console.error('scheduled run dispatch failed:', error));
    }, 1000);
    this.timer.unref();
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    await this.ticking;
    await this.store.serial(async () => undefined);
  }

  async create(owner: ScheduleOwner, input: ScheduleInput): Promise<ScheduledRun> {
    const job = newSchedule(owner, input);

    return this.store.serial(async () => {
      if (this.closed) throw new Error('The scheduler is stopping.');

      const jobs = reserveSchedule(await this.store.read(), owner.chatId);
      await Promise.all((job.backgroundJobIds ?? []).map((id) => this.runs.background.get(owner.chatId, id)));

      const source = await this.runs.find(owner.chatId, owner.sourceRunId);
      job.selection ??= source?.record.selection;
      jobs.push(job);
      await this.store.write(jobs);

      return structuredClone(job);
    });
  }

  list(chatId: string): Promise<ScheduledRun[]> {
    return this.store.serial(async () => (await this.store.read()).filter((job) => job.chatId === chatId));
  }

  listAll(): Promise<ScheduledRun[]> {
    return this.store.serial(() => this.store.read());
  }

  cancel(chatId: string, id: string): Promise<ScheduledRun> {
    return this.store.serial(async () => {
      const jobs = await this.store.read();
      const job = jobs.find((item) => item.id === id && item.chatId === chatId);
      if (!job) throw new Error('Scheduled run not found in this chat.');

      job.status = 'cancelled';
      await this.store.write(jobs);

      return structuredClone(job);
    });
  }

  tick(now = Date.now()): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.ticking) return this.ticking;

    this.ticking = this.process(now).finally(() => {
      this.ticking = undefined;
    });

    return this.ticking;
  }

  private async process(now: number): Promise<void> {
    await this.runs.initialize();
    await this.store.serial(async () => {
      if (this.closed || !this.canDispatch()) return;

      const jobs = await this.store.read();
      for (const job of jobs) {
        if (this.closed || !this.canDispatch()) break;
        if (!['scheduled', 'running'].includes(job.status)) continue;
        if (job.status === 'scheduled' && job.dueAt !== undefined && job.dueAt > now) continue;

        const before = JSON.stringify(job);
        try {
          await this.advance(job, jobs, now);
        } catch (error) {
          job.status = 'failed';
          job.error = String(error);
        }
        if (JSON.stringify(job) !== before) await this.store.write(jobs);
      }
    });
  }

  private async advance(job: ScheduledRun, jobs: ScheduledRun[], now: number): Promise<void> {
    const existing = await this.runs.findRequest(job.chatId, requestId(job));
    if (existing) {
      if (existing.settled) settleSchedule(job, existing, now);

      return;
    }

    const active = await this.runs.find(job.chatId);
    if (active && !active.settled) return;

    const prompt = await readyPrompt(this.runs, job, now);
    if (prompt === undefined || this.closed || !this.canDispatch()) return;

    // Reserve before admission. Restart reconciles the stable request ID first.
    job.status = 'running';
    await this.store.write(jobs);
    if (this.closed || !this.canDispatch()) return;

    await admitScheduled(this.runs, job, prompt);
  }
}
