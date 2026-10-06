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

export type MetricName =
  | 'recall_at_1'
  | 'recall_at_5'
  | 'recall_at_10'
  | 'task_success'
  | 'tool_calls'
  | 'retrieved_tokens'
  | 'latency_ms';

export interface RetrievalReport {
  evaluated: number;
  missing: number;
  results: RetrievalScore[];
  summary: Record<MetricName, number | null>;
  by_complexity: Record<
    string,
    {
      count: number;
      recall_at_5: number | null;
      task_success: number | null;
      tool_calls: number | null;
    }
  >;
}
