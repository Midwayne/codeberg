import type { ModelMessage } from "ai";

export interface SearchResult {
  id: number;
  /** Repo key the hit came from (multi-repo runs); "" or absent on older daemons.
   *  Chunk ids are only unique per repo, so identity is (repo, id). */
  repo?: string;
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
  /** Restrict the search to one repo key; omit to search every indexed repo. */
  repo?: string;
}

export interface Prompt {
  system: string;
  prompt: string;
}

export interface Generator {
  generate(prompt: Prompt): Promise<string>;
}

/** Throughput/latency stats for a completed agent run, surfaced from the
 *  ai-sdk v7 `result.finalStep.performance`. Optional: providers that omit
 *  usage leave it undefined. */
export interface RunPerformance {
  outputTokensPerSecond?: number;
  responseTimeMs?: number;
}

export interface AskResult {
  answer: string;
  sources: SearchResult[];
  performance?: RunPerformance;
}

export interface AskOptions extends SearchOptions {
  messages?: ModelMessage[];
}

/** The minimal surface a conversation needs to produce an answer: ask a
 *  question with optional prior turns, get an answer + sources back. `Agent`
 *  satisfies it; `ChatSession` depends on this rather than the concrete agent,
 *  so the conversation logic is testable with a fake. */
export interface Asker {
  ask(question: string, opts?: AskOptions): Promise<AskResult>;
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
