import type { FeedbackRecord } from '../types.js';

export type DatasetKind =
  | 'retrieval'
  | 'sft'
  | 'preferences'
  | 'rlvr'
  | 'hard_negatives'
  | 'hard_negative_candidates';

export type Provenance =
  | 'user_confirmed'
  | 'tests'
  | 'compiler'
  | 'static_analysis'
  | 'dependency_graph'
  | 'repository_structure'
  | 'agent_inferred'
  | 'answer_referenced';

export interface DatasetExample {
  id: string;
  kind: DatasetKind;
  state: 'candidate' | 'training' | 'eval' | 'dismissed';
  source_interaction_id: string;
  extraction_version: number;
  source_revision: string;
  extracted_at: string;
  query: string;
  repositories: { name: string; branch?: string; commit?: string }[];
  model?: string;
  tool_versions?: Record<string, string>;
  feedback: FeedbackRecord[];
  provenance: Provenance;
  confidence: 'unverified' | 'confirmed' | 'verified';
  payload: Record<string, unknown>;
  review?: { provenance: Provenance; timestamp: string; oracle?: Record<string, unknown> };
}

export function validateReview(
  example: DatasetExample,
  split: 'eval' | 'training',
  review: { provenance: Provenance; oracle?: Record<string, unknown> },
): void {
  if (!ALLOWED_PROVENANCE.includes(review.provenance)) throw new Error('unknown review provenance');

  if (split === 'eval') {
    const verified: Provenance[] = [
      'user_confirmed',
      'tests',
      'compiler',
      'static_analysis',
      'dependency_graph',
      'repository_structure',
    ];

    if (
      !review.oracle ||
      typeof review.oracle !== 'object' ||
      Array.isArray(review.oracle) ||
      Object.keys(review.oracle).length === 0 ||
      !verified.includes(review.provenance)
    ) {
      throw new Error('eval requires reviewed oracle and independent provenance');
    }

    const retrievalOracle = ['files', 'symbols', 'repositories', 'dependency_path'];
    if (
      example.kind === 'retrieval' &&
      !retrievalOracle.some(
        (field) =>
          Array.isArray(review.oracle?.[field]) && (review.oracle[field] as unknown[]).length > 0,
      )
    ) {
      throw new Error(
        'retrieval eval requires at least one reviewed repository, file, symbol or dependency path',
      );
    }
  }

  if (
    split === 'training' &&
    example.kind === 'hard_negative_candidates' &&
    (!Array.isArray(review.oracle?.verified_negatives) ||
      review.oracle.verified_negatives.length === 0)
  ) {
    throw new Error('ambiguous negatives require reviewed negative paths before training');
  }
}

export function exampleFiles(example: DatasetExample): string[] {
  const reviewed = example.review?.oracle?.files;
  const proposed = example.payload.proposed_evidence;

  return [
    ...new Set([
      ...(Array.isArray(reviewed)
        ? reviewed.filter((file): file is string => typeof file === 'string')
        : []),
      ...(Array.isArray(proposed)
        ? proposed.flatMap((hit) =>
            typeof hit === 'object' && hit && typeof hit.path === 'string' ? [hit.path] : [],
          )
        : []),
    ]),
  ];
}

const ALLOWED_PROVENANCE: Provenance[] = [
  'user_confirmed',
  'tests',
  'compiler',
  'static_analysis',
  'dependency_graph',
  'repository_structure',
  'agent_inferred',
  'answer_referenced',
];
