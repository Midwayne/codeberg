import type { DatasetKind } from '@agent/core/learning/datasets/records.js';
import { jsonRequest, responseJson } from './response.js';
import type { ReviewCandidate, ReviewDashboard, ReviewState } from '@agent/core/learning/review-types.js';

export type ExampleKind = DatasetKind;
export type { ReviewDashboard, ReviewState };
export type ReviewSummary = ReviewCandidate;

export const KIND_LABELS: Record<ExampleKind, string> = {
  retrieval: 'Search evidence',
  sft: 'Solved answer',
  preferences: 'Better answer',
  rlvr: 'Verifiable task',
  hard_negatives: 'Incorrect result',
  hard_negative_candidates: 'Possible incorrect result',
};

export interface ReviewExample {
  id: string;
  kind: ExampleKind;
  query: string;
  payload: Record<string, unknown>;
  feedback: Array<{ label: string; reason?: string }>;
  repositories: Array<{ name: string }>;
  provenance: string;
  confidence: string;
}

export async function loadTrainingReview(
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ReviewDashboard> {
  return responseJson(await fetcher('/api/learning/review', { signal }));
}

export async function loadReviewExample(
  id: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ReviewExample> {
  return responseJson(await fetcher(`/api/learning/review/${encodeURIComponent(id)}`, { signal }));
}

export async function submitReview(
  id: string,
  decision: 'training' | 'eval' | 'dismiss',
  oracle?: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await responseJson(
    await fetcher(
      `/api/learning/review/${encodeURIComponent(id)}`,
      jsonRequest('POST', { decision, ...(oracle ? { oracle } : {}) }),
    ),
  );
}

export function exampleAnswer(example: ReviewExample): string {
  if (typeof example.payload.answer === 'string') return example.payload.answer;
  if (typeof example.payload.chosen === 'string') return example.payload.chosen;
  const trajectory = example.payload.successful_trajectory ?? example.payload.trajectory;
  return Array.isArray(trajectory) ? String(trajectory.at(-1)?.answer ?? '') : '';
}

export interface EvidencePreview {
  path: string;
  repo?: string;
  symbol?: string;
  snippet?: string;
}

export function proposedEvidence(
  example: ReviewExample,
  field: 'proposed_evidence' | 'positive' | 'proposed_negatives' | 'hard_negatives',
): EvidencePreview[] {
  const value = example.payload[field];
  if (!Array.isArray(value)) return [];
  return value.flatMap((hit): EvidencePreview[] =>
    hit && typeof hit === 'object' && typeof hit.path === 'string'
      ? [
          {
            path: hit.path,
            repo: typeof hit.repo === 'string' ? hit.repo : undefined,
            symbol: typeof hit.symbol === 'string' ? hit.symbol : undefined,
            snippet: typeof hit.snippet === 'string' ? hit.snippet : undefined,
          },
        ]
      : [],
  );
}
