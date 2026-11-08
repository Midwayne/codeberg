import type { ServerResponse } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { validateReview } from '../../core/learning/datasets/records.js';
import type { DatasetExample } from '../../core/learning/datasets/records.js';
import { LearningError } from '../../core/learning/errors.js';
import { learningErrorStatus, sendLearningError } from './errors.js';

function response() {
  const res = { setHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn() };

  return res as unknown as ServerResponse & typeof res;
}

describe('learning route errors', () => {
  it('maps each refusal kind to one HTTP status', () => {
    expect(learningErrorStatus('invalid')).toBe(400);
    expect(learningErrorStatus('not_found')).toBe(404);
    expect(learningErrorStatus('conflict')).toBe(409);
  });

  it('keeps the established error text as the response body', () => {
    const res = response();

    sendLearningError(res, new LearningError('conflict', 'learning is busy'));

    expect(res.writeHead).toHaveBeenCalledWith(409, expect.anything());
    expect(res.end).toHaveBeenCalledWith('Error: learning is busy');
  });

  it('rethrows failures that are not learning refusals', () => {
    const failure = new Error('disk full');

    expect(() => sendLearningError(response(), failure)).toThrow(failure);
  });

  it('reports unreviewed ambiguous negatives as invalid input', () => {
    const example = { kind: 'hard_negative_candidates' } as DatasetExample;

    expect(() => validateReview(example, 'training', { provenance: 'user_confirmed' })).toThrow(
      expect.objectContaining({ kind: 'invalid' }),
    );
  });
});
