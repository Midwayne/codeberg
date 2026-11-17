import type { DreamingDashboard } from '@agent/core/learning/dreaming/review';
import type { DreamingDecision, DreamingReport } from '@agent/core/learning/dreaming/types';
import { jsonInit, readJson } from './http';
export type { DreamingDashboard, DreamingDecision, DreamingReport };

export async function dreamingRequest<T>(fetcher: typeof fetch, path = '', body?: unknown): Promise<T> {
  const signal = AbortSignal.timeout(10_000);
  const init = body === undefined ? { signal } : jsonInit('POST', body, { signal });
  const response = await fetcher(`/api/learning/dreaming${path}`, init);

  return readJson<T>(response, 'Knowledge consolidation request failed.');
}
