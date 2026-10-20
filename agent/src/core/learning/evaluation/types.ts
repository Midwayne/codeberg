export interface EvalScore {
  name: string;
  score: number | null;
  metadata?: Record<string, unknown>;
}

export interface OutputRun {
  eval_id: string;
  output: unknown;
  /** Actual context supplied to the candidate, in retrieval order. */
  context?: string[];
  model?: string;
}

export interface ScorerInput {
  input: string;
  output: unknown;
  expected?: unknown;
  context?: string[];
  output_format?: unknown;
}

export interface OutputScorer {
  name: string;
  score(input: ScorerInput): EvalScore | Promise<EvalScore>;
}

export interface ScoreSummary {
  mean: number | null;
  scored: number;
  skipped: number;
  errors: number;
}

export interface OutputResult {
  eval_id: string;
  source_interaction_id: string;
  source_revision: string;
  repository_commits: { name: string; commit?: string }[];
  model?: string;
  scores: (EvalScore & { error?: string })[];
}

export interface OutputReport {
  version: 1;
  total: number;
  evaluated: number;
  missing: string[];
  results: OutputResult[];
  summary: Record<string, ScoreSummary>;
}
