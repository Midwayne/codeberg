export type DecisionApi = 'openai' | 'system-one' | 'cloudflare';

/** Catalog metadata only. Credentials are read from the environment at call time. */
export interface DecisionModel {
  key: string;
  provider: string;
  label: string;
  model: string;
  api: DecisionApi;
  endpoint: string;
  apiKeyEnv: string;
}

export interface DecisionQuestion {
  name: string;
  type: 'predicate' | 'choice' | 'score';
  instructions: string;
  choices?: Array<{ value: string; description?: string }>;
  levels?: string[];
}

export interface DecisionRequest {
  state: string;
  questions: DecisionQuestion[];
  /** Supplied by Codeberg's file reader, outside the main model's context. */
  evidence?: string;
}

export interface DecisionFile {
  repo: string;
  path: string;
  start_line?: number;
  end_line?: number;
}

export interface DecisionToolInput {
  state: string;
  questions?: DecisionQuestion[];
  files?: DecisionFile[];
}

export interface DecisionFileSummary extends DecisionFile {
  question?: string;
  start_line: number;
  end_line: number;
  total_lines: number;
  characters: number;
  truncated: boolean;
}

export interface DecisionAnswer {
  name: string;
  type: DecisionQuestion['type'] | 'refusal';
  probability?: number;
  choice?: string;
  score?: number;
  confidence?: number;
  probabilities?: Array<{ value: string | number; probability: number; label?: string }>;
}

export interface DecisionResult {
  answers: DecisionAnswer[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  };
}

export interface DecisionToolResult extends DecisionResult {
  cached: boolean;
  files?: DecisionFileSummary[];
}

export type DecisionUsageSink = (model: DecisionModel, usage: DecisionResult['usage']) => Promise<void>;
