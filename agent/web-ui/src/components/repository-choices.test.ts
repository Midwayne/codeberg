import { expect, it } from 'vitest';

import { bulkIgnored, matchingChoices, repositorySummary } from './repository-choices';

const choices = ['api', 'billing', 'web/portal'].map((path) => ({ path, key: path, detail: '' }));

it('filters choices by folder path, ignoring case', () => {
  expect(matchingChoices(choices, 'PORT').map((choice) => choice.path)).toEqual(['web/portal']);
  expect(matchingChoices(choices, '  ')).toHaveLength(3);
});

it('checks or unchecks only the choices shown', () => {
  const shown = matchingChoices(choices, 'i');

  expect(bulkIgnored(['web/portal'], shown, false).sort()).toEqual(['api', 'billing', 'web/portal']);
  expect(bulkIgnored(['api', 'web/portal'], shown, true)).toEqual(['web/portal']);
});

it('describes how many repositories are indexed separately', () => {
  expect(repositorySummary(50, 0)).toBe('50 repositories found · all indexed separately');
  expect(repositorySummary(50, 3)).toBe('50 repositories found · 47 of 50 indexed separately');
  expect(repositorySummary(1, 0)).toBe('1 repository found · indexed separately');
  expect(repositorySummary(2, 2)).toBe('2 repositories found · none indexed separately');
});
