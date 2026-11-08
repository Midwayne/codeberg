import { expect, it } from 'vitest';

import { isDreamingReportId } from '../dreaming/reports.js';
import { isEvaluationId } from '../evaluation/reports.js';
import { isStableId, stableId } from './identity.js';

it('accepts only the ids stableId produces', () => {
  const example = stableId('example', 'interaction', 'retrieval');
  const evaluation = stableId('evaluation', 'read-only-rag-v1');

  expect(isStableId('example', example)).toBe(true);
  expect(isStableId('evaluation', evaluation)).toBe(true);
  expect(isEvaluationId(evaluation)).toBe(true);
  expect(isEvaluationId(example)).toBe(false);
  expect(isStableId('example', `${example}a`)).toBe(false);
  expect(isStableId('example', example.slice(0, -1))).toBe(false);
  expect(isStableId('example', example.toUpperCase())).toBe(false);
  expect(isStableId('job', example)).toBe(false);
});

it('accepts dreaming report ids and rejects path-like values', () => {
  expect(isDreamingReportId('dream-daily-2026-11-08')).toBe(true);
  expect(isDreamingReportId(`dream-${'a'.repeat(70)}`)).toBe(true);
  expect(isDreamingReportId(`dream-${'a'.repeat(71)}`)).toBe(false);
  expect(isDreamingReportId('dream-')).toBe(false);
  expect(isDreamingReportId('dream-../secret')).toBe(false);
  expect(isDreamingReportId('Dream-abc')).toBe(false);
});
