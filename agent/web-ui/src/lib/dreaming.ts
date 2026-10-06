import type { DreamingDashboard } from '@agent/core/learning/dreaming/review';
import type { DreamingDecision, DreamingReport } from '@agent/core/learning/dreaming/types';
export type { DreamingDashboard, DreamingDecision, DreamingReport };

export async function dreamingRequest<T>(fetcher: typeof fetch, path = '', body?: unknown): Promise<T> {
  const response = await fetcher(`/api/learning/dreaming${path}`, {
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(await response.text() || 'Knowledge consolidation request failed.');
  return response.json() as Promise<T>;
}
