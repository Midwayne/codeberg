import type { DatasetKind } from './datasets/records.js';

export type ReviewState = 'ready' | 'training' | 'eval' | 'dismissed' | 'stale';

export interface ReviewCandidate {
  id: string;
  kind: DatasetKind;
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
    by_kind: Partial<Record<DatasetKind, number>>;
  };
  candidates: ReviewCandidate[];
}
