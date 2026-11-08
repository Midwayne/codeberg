import { expect, it } from 'vitest';

import { REVIEW_ORACLE_FIELDS } from '../../core/learning/datasets/records.js';
import { reviewOracle } from './review-routes.js';

it('accepts exactly the shared review oracle fields', () => {
  const oracle = {
    files: ['src/a.ts'],
    symbols: ['foo'],
    repositories: ['repo'],
    dependency_path: ['client', 'producer'],
    verified_negatives: ['src/no.ts'],
    notes: 'checked against the current revision',
  };

  expect(reviewOracle(oracle)).toEqual(oracle);
  expect(REVIEW_ORACLE_FIELDS.every((field) => field in oracle)).toBe(true);
  expect(reviewOracle({ ...oracle, extra: ['x'] })).toBeUndefined();
  expect(reviewOracle({})).toBeUndefined();
});
