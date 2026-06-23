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

export interface AskResult {
  answer: string;
  sources: SearchResult[];
}
