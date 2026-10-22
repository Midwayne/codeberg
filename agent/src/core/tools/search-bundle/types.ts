import type { SearchResult } from '../../types.js';

export interface BundleQuery {
  repo: string;
  query: string;
}

export interface BundleInput {
  queries: BundleQuery[];
}

export interface BundleHit extends SearchResult {
  body?: string;
  truncated?: boolean;
}

export interface BundleError {
  repo: string;
  stage: 'search' | 'chunk';
  error: string;
}

export interface EvidenceBundle {
  evidence: BundleHit[];
  errors: BundleError[];
  omitted: number;
}

export const MAX_BUNDLE_CHARS = 10_000;
export const MAX_BUNDLE_HITS = 8;

export function validatePlan(input: BundleInput): BundleQuery[] {
  if (!input || Object.keys(input).some((key) => key !== 'queries') || !Array.isArray(input.queries)
    || input.queries.length < 1 || input.queries.length > 4) throw new Error('Expected one to four repository/query pairs.');

  for (const row of input.queries) {
    if (!row || typeof row.repo !== 'string' || !row.repo.trim() || row.repo.length > 128
      || typeof row.query !== 'string' || !row.query.trim() || row.query.length > 1000
      || Object.keys(row).some((key) => key !== 'repo' && key !== 'query')) {
      throw new Error('Each search needs a repository key and a query of at most 1,000 characters.');
    }
  }

  return input.queries;
}
