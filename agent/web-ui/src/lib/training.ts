export type ExampleKind = 'retrieval' | 'sft' | 'preferences' | 'rlvr' | 'hard_negatives' | 'hard_negative_candidates';
export type ReviewState = 'ready' | 'training' | 'eval' | 'dismissed' | 'stale';

export const KIND_LABELS: Record<ExampleKind, string> = {
  retrieval: 'Search evidence',
  sft: 'Solved answer',
  preferences: 'Better answer',
  rlvr: 'Verifiable task',
  hard_negatives: 'Incorrect result',
  hard_negative_candidates: 'Possible incorrect result',
};

export interface ReviewSummary {
  id: string;
  kind: ExampleKind;
  query: string;
  extracted_at: string;
  state: ReviewState;
  eligible: boolean;
  feedback?: { label: string; reason?: string };
  repositories: string[];
  answer_preview: string;
  proposed_files: string[];
}

export interface ReviewDashboard {
  stats: {
    total: number;
    ready: number;
    training: number;
    eval: number;
    dismissed: number;
    stale: number;
    by_kind: Partial<Record<ExampleKind, number>>;
  };
  candidates: ReviewSummary[];
}

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

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export async function loadTrainingReview(signal?: AbortSignal): Promise<ReviewDashboard> {
  return readResponse(await fetch('/api/learning/review', { signal }));
}

export async function loadReviewExample(id: string, signal?: AbortSignal): Promise<ReviewExample> {
  return readResponse(await fetch(`/api/learning/review/${encodeURIComponent(id)}`, { signal }));
}

export async function submitReview(id: string, decision: 'training' | 'eval' | 'dismiss', oracle?: Record<string, unknown>): Promise<void> {
  await readResponse(await fetch(`/api/learning/review/${encodeURIComponent(id)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, ...(oracle ? { oracle } : {}) }),
  }));
}

export function exampleAnswer(example: ReviewExample): string {
  if (typeof example.payload.answer === 'string') return example.payload.answer;
  if (typeof example.payload.chosen === 'string') return example.payload.chosen;
  const trajectory = example.payload.successful_trajectory ?? example.payload.trajectory;
  return Array.isArray(trajectory) ? String(trajectory.at(-1)?.answer ?? '') : '';
}

export interface EvidencePreview { path: string; repo?: string; symbol?: string; snippet?: string }

export function proposedEvidence(example: ReviewExample, field: 'proposed_evidence' | 'positive' | 'proposed_negatives' | 'hard_negatives'): EvidencePreview[] {
  const value = example.payload[field];
  if (!Array.isArray(value)) return [];
  return value.flatMap((hit): EvidencePreview[] => hit && typeof hit === 'object' && typeof hit.path === 'string'
    ? [{ path: hit.path, repo: typeof hit.repo === 'string' ? hit.repo : undefined,
      symbol: typeof hit.symbol === 'string' ? hit.symbol : undefined,
      snippet: typeof hit.snippet === 'string' ? hit.snippet : undefined }]
    : []);
}
