import { DatasetStore, type DatasetExample } from './datasets.js';
import { effectiveFeedback, type LearningStore } from './store.js';
import type { AttemptRecord } from './types.js';

export interface RetrievalRun {
  eval_id: string;
  hits: { repo?: string; path?: string; symbol?: string }[];
  tool_calls?: number;
  retrieved_tokens?: number;
  latency_ms?: number;
  success?: boolean;
}

export interface RetrievalScore {
  eval_id: string;
  source_interaction_id: string;
  repository_commits: { name: string; commit?: string }[];
  oracle_files: number;
  oracle_repositories: number;
  oracle_symbols: number;
  dependency_hops: number | null;
  recall_at_1: number | null;
  recall_at_5: number | null;
  recall_at_10: number | null;
  oracle_repo_hit: boolean | null;
  oracle_symbol_hit: boolean | null;
  task_success: number | null;
  tool_calls: number | null;
  retrieved_tokens: number | null;
  latency_ms: number | null;
}

type MetricName = 'recall_at_1' | 'recall_at_5' | 'recall_at_10' |
  'task_success' | 'tool_calls' | 'retrieved_tokens' | 'latency_ms';

interface RetrievalReport {
  evaluated: number;
  missing: number;
  results: RetrievalScore[];
  summary: Record<MetricName, number | null>;
  by_complexity: Record<string, {
    count: number;
    recall_at_5: number | null;
    task_success: number | null;
    tool_calls: number | null;
  }>;
}

/** Accept runs from any retriever or retrieval agent against the same held-out IDs. */
export function scoreRetrievalRuns(evals: DatasetExample[], runs: RetrievalRun[]): RetrievalReport {
  const byId = new Map(runs.map((run) => [run.eval_id, run]));
  const results: RetrievalScore[] = evals.filter((example) => example.kind === 'retrieval').flatMap((example) => {
    const run = byId.get(example.id);
    if (!run || !Array.isArray(run.hits)) return [];
    const oracle = example.review?.oracle ?? {};
    const files = strings(oracle.files);
    const repos = strings(oracle.repositories);
    const symbols = strings(oracle.symbols);
    const recall = (k: number) => files.length
      ? files.filter((file) => run.hits.slice(0, k).some((hit) => hit.path === file)).length / files.length
      : null;
    return [{ eval_id: example.id, source_interaction_id: example.source_interaction_id,
      repository_commits: example.repositories.map((repo) => ({ name: repo.name, commit: repo.commit })),
      oracle_files: files.length, oracle_repositories: repos.length, oracle_symbols: symbols.length,
      dependency_hops: Array.isArray(oracle.dependency_path) ? Math.max(0, oracle.dependency_path.length - 1) : null,
      recall_at_1: recall(1), recall_at_5: recall(5), recall_at_10: recall(10),
      oracle_repo_hit: repos.length ? repos.every((repo) => run.hits.some((hit) => hit.repo === repo)) : null,
      oracle_symbol_hit: symbols.length ? symbols.every((symbol) => run.hits.some((hit) => hit.symbol === symbol)) : null,
      task_success: run.success === undefined ? null : Number(run.success), tool_calls: run.tool_calls ?? null,
      retrieved_tokens: run.retrieved_tokens ?? null, latency_ms: run.latency_ms ?? null }];
  });
  const groups = new Map<string, RetrievalScore[]>();
  for (const row of results) {
    const key = complexityBucket(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const retrievalCount = evals.filter((example) => example.kind === 'retrieval').length;
  return { evaluated: results.length, missing: retrievalCount - results.length, results,
    summary: { recall_at_1: average(results, 'recall_at_1'), recall_at_5: average(results, 'recall_at_5'), recall_at_10: average(results, 'recall_at_10'),
      task_success: average(results, 'task_success'), tool_calls: average(results, 'tool_calls'),
      retrieved_tokens: average(results, 'retrieved_tokens'), latency_ms: average(results, 'latency_ms') },
    by_complexity: Object.fromEntries([...groups].map(([key, rows]) => [key, {
      count: rows.length, recall_at_5: average(rows, 'recall_at_5'),
      task_success: average(rows, 'task_success'), tool_calls: average(rows, 'tool_calls'),
    }])) };
}

/** Historical attempts are a baseline, not a rerun against today's repository. */
export async function historicalEvalMetrics(store: LearningStore) {
  const [evals, events] = await Promise.all([new DatasetStore(store).active('eval'), store.events()]);
  const grades = effectiveFeedback(events);
  const attemptsByInteraction = new Map<string, AttemptRecord[]>();
  for (const event of events) {
    if (event.type !== 'attempt_recorded') continue;
    const id = event.attempt.interaction_id;
    const attempts = attemptsByInteraction.get(id) ?? [];
    attempts.push(event.attempt);
    attemptsByInteraction.set(id, attempts);
  }
  const runs: RetrievalRun[] = [];
  for (const example of evals.filter((row) => row.kind === 'retrieval')) {
    const attempts = attemptsByInteraction.get(example.source_interaction_id) ?? [];
    const final = attempts.at(-1);
    runs.push({ eval_id: example.id, hits: attempts.flatMap((attempt) => attempt.retrieved_results.filter((hit) =>
      /search|grep|symbol|reference/i.test(hit.tool))),
    tool_calls: attempts.reduce((total, attempt) => total + attempt.tools_invoked.length, 0),
    retrieved_tokens: attempts.reduce((total, attempt) => total + (attempt.token_usage?.retrieved ?? 0), 0) || undefined,
    latency_ms: attempts.reduce((total, attempt) => total + (attempt.latency_ms ?? 0), 0) || undefined,
    success: final ? grades.get(final.attempt_id)?.label === 'solved' : undefined });
  }
  return scoreRetrievalRuns(evals, runs);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function average(rows: RetrievalScore[], name: MetricName): number | null {
  const values = rows.map((row) => row[name]).filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function complexityBucket(row: RetrievalScore): string {
  const repositories = row.oracle_repositories === 0 ? 'unknown-repo' :
    row.oracle_repositories > 1 ? 'multi-repo' : 'single-repo';
  const files = row.oracle_files === 0 ? 'unknown-file' :
    row.oracle_files > 1 ? 'multi-file' : 'single-file';
  const path = row.dependency_hops === null ? 'unknown-path' :
    row.dependency_hops > 1 ? 'multi-hop' : 'short-path';
  return `${repositories}/${files}/${path}`;
}
