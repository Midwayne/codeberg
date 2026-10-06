import type { MetricName, RetrievalScore } from './types.js';

export function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

export function average(rows: RetrievalScore[], name: MetricName): number | null {
  const values = rows.map((row) => row[name]).filter((value): value is number => value !== null);

  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function complexityBucket(row: RetrievalScore): string {
  const repositories =
    row.oracle_repositories === 0
      ? 'unknown-repo'
      : row.oracle_repositories > 1
        ? 'multi-repo'
        : 'single-repo';

  const files =
    row.oracle_files === 0 ? 'unknown-file' : row.oracle_files > 1 ? 'multi-file' : 'single-file';
  const path =
    row.dependency_hops === null
      ? 'unknown-path'
      : row.dependency_hops > 1
        ? 'multi-hop'
        : 'short-path';

  return `${repositories}/${files}/${path}`;
}
