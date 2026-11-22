import type { ScheduleSummary } from '@agent/core/schedules/summary';

type Part = { state?: string; input?: unknown; output?: unknown };

type Wake = { id?: unknown; status?: unknown; dueAt?: unknown; createdAt?: unknown; backgroundJobIds?: unknown };

/** Longer than the schedule list's refresh interval: a wake-up this old and still unlisted has ended. */
const LISTED_WITHIN_MS = 60_000;

export type SleepPhase = 'saving' | 'sleeping' | 'waking' | 'awake' | 'cancelled' | 'failed';

/** A `sleep_agent` call as the chat shows it: a timeline marker that follows its wake-up. */
export interface SleepView {
  phase: SleepPhase;
  label: string;
  detail?: string;
  prompt?: string;
  dueAt?: number;
}

/** `jobs` is the project's live schedule list, when the browser has one. */
export function sleepView(part: Part, jobs: ScheduleSummary[] | undefined, now: number): SleepView | undefined {
  const prompt = promptOf(part.input);

  if (part.state === 'output-error') return undefined;

  if (part.state !== 'output-available') return { phase: 'saving', label: 'Going to sleep…', prompt };

  const wake = ((part.output as { wake?: Wake } | undefined)?.wake ?? {}) as Wake;
  const dueAt = typeof wake.dueAt === 'number' ? wake.dueAt : undefined;
  const live = jobs?.find((job) => job.id === wake.id);
  const phase = phaseOf(live?.status ?? savedStatus(wake, jobs, now), dueAt, now, Boolean(live));

  return { phase, label: labelOf(phase, dueAt, now), detail: detailOf(phase, wake, live), prompt, dueAt };
}

/**
 * The status the sleep saved, unless a loaded schedule list has had time to
 * show its wake-up and no longer does: then it already ran (an early wake)
 * or its history was pruned.
 */
function savedStatus(wake: Wake, jobs: ScheduleSummary[] | undefined, now: number): string {
  const createdAt = typeof wake.createdAt === 'number' ? wake.createdAt : undefined;

  if (jobs && createdAt !== undefined && now - createdAt > LISTED_WITHIN_MS) return 'completed';

  return typeof wake.status === 'string' ? wake.status : 'scheduled';
}

function phaseOf(status: string, dueAt: number | undefined, now: number, live: boolean): SleepPhase {
  switch (status) {
    case 'running':
      return 'waking';
    case 'completed':
      return 'awake';
    case 'cancelled':
      return 'cancelled';
    case 'failed':
      return 'failed';
    default:
      if (dueAt === undefined || dueAt > now) return 'sleeping';

      // Past its time: still listed means it is about to run; gone means it already did.
      return live ? 'waking' : 'awake';
  }
}

function labelOf(phase: SleepPhase, dueAt: number | undefined, now: number): string {
  switch (phase) {
    case 'saving':
      return 'Going to sleep…';
    case 'sleeping':
      return dueAt === undefined ? 'Sleeping' : `Sleeping · wakes in ${countdown(dueAt - now)}`;
    case 'waking':
      return 'Waking up…';
    case 'awake':
      return 'Woke up';
    case 'cancelled':
      return 'Wake-up cancelled';
    case 'failed':
      return 'Wake-up failed';
    default:
      return phase satisfies never;
  }
}

function detailOf(phase: SleepPhase, wake: Wake, live: ScheduleSummary | undefined): string | undefined {
  if (phase === 'failed') return live?.error;

  const waiting = Array.isArray(wake.backgroundJobIds) ? wake.backgroundJobIds.length : 0;
  if (phase !== 'sleeping' || waiting === 0) return undefined;

  return `or as soon as ${waiting === 1 ? '1 background job finishes' : `all ${waiting} background jobs finish`}`;
}

/** "45s", "10m", "1h 05m". */
export function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));

  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function promptOf(input: unknown): string | undefined {
  const prompt = (input as { prompt?: unknown } | undefined)?.prompt;

  return typeof prompt === 'string' ? prompt : undefined;
}
