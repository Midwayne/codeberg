import type { FailureCategory } from './types.js';

/**
 * A learning-job failure whose retry category is known where it is thrown.
 * The message keeps the `CATEGORY: detail` form stored in job records.
 */
export class LearningFailure extends Error {
  constructor(readonly category: FailureCategory, detail: string) {
    super(`${category}: ${detail}`);
  }
}

/** Retrying cannot help, e.g. the task or interaction no longer exists. */
export function permanentFailure(detail: string): LearningFailure {
  return new LearningFailure('PERMANENT_ERROR', detail);
}

/** The model answered, but not in a usable shape. */
export function invalidResponse(detail: string): LearningFailure {
  return new LearningFailure('INVALID_RESPONSE', detail);
}
