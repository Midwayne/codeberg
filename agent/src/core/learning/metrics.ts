import { DatasetStore, type DatasetExample } from './datasets.js';
import { effectiveFeedback, type LearningStore } from './store.js';

export interface RetrievalRun {
  eval_id: string;
  hits: { repo?: string; path?: string; symbol?: string }[];
  tool_calls?: number;
  retrieved_tokens?: number;
  latency_ms?: number;
  success?: boolean;
}

/** Accept runs from any retriever or retrieval agent against the same held-out IDs. */
export function scoreRetrievalRuns(evals: DatasetExample[], runs: RetrievalRun[]): {
  evaluated: number;
  missing: number;
  results: Record<string, unknown>[];
  summary: Record<string, number | null>;
  by_complexity: Record<string, { count: number; recall_at_5: number | null; task_success: number | null; tool_calls: number | null }>;
} {
  const byId = new Map(runs.map((run) => [run.eval_id, run]));
  const results: Record<string, unknown>[] = evals.filter((example) => example.kind === 'retrieval').flatMap((example) => {
    const run = byId.get(example.id);
    if (!run || !Array.isArray(run.hits)) return [];
    const oracle = example.review?.oracle ?? {};
    const files = strings(oracle.files);
    const repos = strings(oracle.repositories);
    const symbols = strings(oracle.symbols);
    const recall = (k: number) => files.length ? files.filter((file) => run.hits.slice(0, k).some((hit) => hit.path === file)).length / files.length : null;
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
  const average = (rows: Record<string, unknown>[], name: string): number | null => {
    const numbers = rows.map((row) => row[name]).filter((value): value is number => typeof value === 'number');
    return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
  };
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of results) {
    const key = `${row.oracle_repositories === 0 ? 'unknown-repo' : Number(row.oracle_repositories) > 1 ? 'multi-repo' : 'single-repo'}/` +
      `${row.oracle_files === 0 ? 'unknown-file' : Number(row.oracle_files) > 1 ? 'multi-file' : 'single-file'}/` +
      `${row.dependency_hops === null ? 'unknown-path' : Number(row.dependency_hops) > 1 ? 'multi-hop' : 'short-path'}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
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
  const runs: RetrievalRun[] = [];
  for (const example of evals.filter((row) => row.kind === 'retrieval')) {
    const attempts = events.flatMap((event) => event.type === 'attempt_recorded' &&
      event.attempt.interaction_id === example.source_interaction_id ? [event.attempt] : []);
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
