export interface SearchResult {
  id: number;
  path: string;
  symbol: string;
  start_line: number;
  end_line: number;
  score: number;
  snippet: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

export interface SearchOptions {
  k?: number;
}

export interface Prompt {
  system: string;
  prompt: string;
}

export interface Generator {
  generate(prompt: Prompt): Promise<string>;
}

/** Throughput/latency stats for a completed agent run, surfaced from the
 *  ai-sdk v7 `result.finalStep.performance`. Optional: the legacy `askOnce`
 *  path and providers that omit usage leave it undefined. */
export interface RunPerformance {
  outputTokensPerSecond?: number;
  responseTimeMs?: number;
}

export interface AskResult {
  answer: string;
  sources: SearchResult[];
  performance?: RunPerformance;
}

/** Reasoning-effort levels accepted by ai-sdk v7's standardized `reasoning`
 *  option (`LanguageModelV4CallOptions['reasoning']`). */
export type ReasoningEffort =
  | "provider-default"
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export interface Turn {
  role: "user" | "assistant";
  content: string;
  sources?: SearchResult[];
}
