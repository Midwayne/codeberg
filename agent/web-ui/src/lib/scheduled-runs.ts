import { BACKGROUND_STATUSES } from '@agent/core/background/types';
import {
  SCHEDULE_STATUSES,
  type ScheduleCancelResult,
  type ScheduleSummary,
} from '@agent/core/schedules/summary';
import { jsonRequest } from './response.js';

export async function loadSchedules(api: typeof fetch, signal?: AbortSignal): Promise<ScheduleSummary[]> {
  const response = await api('/api/schedules', { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(await response.text() || 'Could not load scheduled runs. Refresh to retry.');

  const jobs: unknown = await response.json();
  if (!Array.isArray(jobs) || !jobs.every(validSummary)) throw new Error('Invalid scheduled runs response. Refresh to retry.');

  return jobs;
}

export async function cancelSchedule(api: typeof fetch, id: string, signal?: AbortSignal): Promise<ScheduleCancelResult> {
  const response = await api(`/api/schedules/${encodeURIComponent(id)}/cancel`, jsonRequest('POST', {}, signal));
  if (!response.ok) throw new Error(await response.text() || 'Could not cancel the schedule. Try again.');

  const result = await response.json();
  if (!result || result.id !== id || typeof result.stopping !== 'boolean') throw new Error('Invalid cancellation response. Refresh to check the schedule.');

  return result;
}

function validSummary(value: unknown): value is ScheduleSummary {
  if (!value || typeof value !== 'object') return false;

  const row = value as ScheduleSummary;

  return ['id', 'chatId', 'chatTitle', 'prompt'].every((key) => typeof row[key as keyof ScheduleSummary] === 'string')
    && (row.kind === undefined || row.kind === 'background')
    && (row.backgroundStatus === undefined || BACKGROUND_STATUSES.includes(row.backgroundStatus))
    && (row.backgroundJobIds === undefined || Array.isArray(row.backgroundJobIds) && row.backgroundJobIds.every((id) => typeof id === 'string'))
    && typeof row.chatDeleted === 'boolean' && Number.isFinite(row.createdAt)
    && SCHEDULE_STATUSES.includes(row.status)
    && [row.dueAt, row.everySeconds].every((number) => number === undefined || typeof number === 'number' && Number.isFinite(number))
    && [row.afterToolCallId, row.model, row.error, row.lastRunId].every((text) => text === undefined || typeof text === 'string')
    && (row.activeRun === undefined || Boolean(row.activeRun && typeof row.activeRun.id === 'string' && typeof row.activeRun.stopping === 'boolean'));
}
