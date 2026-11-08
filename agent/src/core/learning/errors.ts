import type { FailureCategory } from './types.js';

export type LearningErrorKind = 'not_found' | 'conflict' | 'invalid';

/** An expected refusal whose message is safe to show; callers map `kind`, never the text. */
export class LearningError extends Error {
  constructor(
    readonly kind: LearningErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/** A job failure classified where it is raised instead of by matching its text later. */
export class JobFailure extends Error {
  constructor(
    readonly category: FailureCategory,
    message: string,
  ) {
    super(message);
    this.name = category;
  }
}

/** Settings or maintenance paused a claimed job; it returns to the queue without a failed attempt. */
export class LearningPaused extends Error {}
