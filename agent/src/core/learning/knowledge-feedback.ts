import type { FeedbackLabel } from './types.js';

/**
 * Ratings that confirm an answer well enough to distill source-backed knowledge.
 * "Mostly correct" counts: extraction still keeps only claims quoted from current source.
 */
export function capturesKnowledge(label: FeedbackLabel | undefined): boolean {
  return label === 'solved' || label === 'mostly_correct';
}
