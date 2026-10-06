import { type useReviewDetail } from '../components/review-detail';

import { proposedEvidence, type EvidencePreview } from './training';

export type ReviewEvidenceOptions = Pick<Parameters<typeof useReviewDetail>[0], 'example' | 'destination' | 'row'>;

export function collectReviewEvidence({ example, destination, row }: ReviewEvidenceOptions) {
  const evidence = proposedEvidence(example, 'proposed_evidence');

  const positive = proposedEvidence(example, 'positive');

  const negatives = proposedEvidence(example, 'proposed_negatives');

  const hardNegatives = proposedEvidence(example, 'hard_negatives');

  const verifier = example.payload.verifier;

  const verifierFiles: EvidencePreview[] =
    verifier && typeof verifier === 'object' && 'proposed_files' in verifier && Array.isArray(verifier.proposed_files)
      ? verifier.proposed_files.filter((path): path is string => typeof path === 'string').map((path) => ({ path }))
      : [];

  const choices =
    destination === 'training' && row.kind === 'hard_negative_candidates'
      ? negatives
      : evidence.length
        ? evidence
        : positive.length
          ? positive
          : verifierFiles;

  const allEvidence = new Map<string, EvidencePreview>();

  for (const hit of [
    ...evidence,
    ...positive,
    ...negatives,
    ...hardNegatives,
    ...verifierFiles,
    ...row.proposed_files.map((path) => ({ path })),
  ]) {
    if (!allEvidence.has(hit.path)) allEvidence.set(hit.path, hit);
  }

  return { allEvidence, choices };
}
