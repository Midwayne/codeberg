import type { ScheduleSummary } from '@agent/core/schedules/summary';
import { cancelSchedule, loadSchedules } from './scheduled-runs';

export interface ScheduleUpdates {
  jobs: (value: ScheduleSummary[]) => void;
  loading: (value: boolean) => void;
  readError: (value: string) => void;
  cancelError: (value: string) => void;
  busy: (value: string | undefined) => void;
  notice: (value: string) => void;
}

/** A mutation supersedes reads; late responses and unmounted views cannot replace state. */
export class ScheduleRequests {
  private reading?: AbortController;
  private saving?: AbortController;
  private closed = false;

  constructor(private readonly api: typeof fetch, private readonly updates: ScheduleUpdates) {}

  activate(): void {
    this.closed = false;
  }

  close(): void {
    this.closed = true;
    this.reading?.abort();
    this.saving?.abort();
    this.reading = undefined;
    this.saving = undefined;
  }

  async refresh(): Promise<void> {
    if (this.closed || this.reading || this.saving) return;

    const controller = new AbortController();
    this.reading = controller;
    this.updates.loading(true);
    try {
      const jobs = await loadSchedules(this.api, timedSignal(controller));
      if (this.closed || controller.signal.aborted) return;

      this.updates.jobs(jobs);
      this.updates.readError('');
    } catch (error) {
      if (!this.closed && !controller.signal.aborted) this.updates.readError(String(error));
    } finally {
      if (this.reading === controller) {
        this.reading = undefined;
        if (!this.closed) this.updates.loading(false);
      }
    }
  }

  async cancel(id: string): Promise<void> {
    if (this.closed || this.saving) return;

    this.reading?.abort();
    this.reading = undefined;
    this.updates.loading(false);
    const controller = new AbortController();
    this.saving = controller;
    this.updates.busy(id);
    this.updates.cancelError('');
    this.updates.notice('');
    try {
      const result = await cancelSchedule(this.api, id, timedSignal(controller));
      if (this.closed || controller.signal.aborted) return;

      this.updates.notice(result.kind === 'background' ? 'Background tool cancellation requested. The tool may take time to stop.'
        : result.stopping ? 'Schedule cancelled. The active run is stopping.' : 'Schedule cancelled.');
    } catch (error) {
      if (!this.closed && !controller.signal.aborted) this.updates.cancelError(String(error));
    } finally {
      if (this.saving === controller) {
        this.saving = undefined;
        if (!this.closed) {
          await this.refresh();
          if (!this.closed) this.updates.busy(undefined);
        }
      }
    }
  }
}

function timedSignal(controller: AbortController): AbortSignal {
  return AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
}
