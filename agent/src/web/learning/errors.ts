import type { ServerResponse } from 'node:http';
import { LearningError, type LearningErrorKind } from '../../core/learning/errors.js';
import { sendText } from '../http.js';

export function learningErrorStatus(kind: LearningErrorKind): number {
  switch (kind) {
    case 'invalid':
      return 400;
    case 'not_found':
      return 404;
    case 'conflict':
      return 409;
    default: {
      const never: never = kind;
      return never;
    }
  }
}

/** Sends a learning refusal with its mapped status; rethrows anything else. */
export function sendLearningError(
  res: ServerResponse,
  error: unknown,
  body: (error: LearningError) => string = String,
): void {
  if (!(error instanceof LearningError)) throw error;

  sendText(res, learningErrorStatus(error.kind), body(error));
}
