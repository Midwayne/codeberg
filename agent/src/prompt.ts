import type { Prompt } from "./types.js";

const SYSTEM = `You are a precise code-search assistant. Answer using ONLY retrieved code. Cite sources as [path:start-end]. If evidence is insufficient, say so.`;

export const AGENT_SYSTEM = `You are a code-search agent. Use tools iteratively (max rounds) then answer with citations.

- search_code: semantic search — start here for conceptual questions. Returns path, line range, snippet.
- grep: exact text/regex over files.
- glob: find files by pattern.
- read_file: read file content or a line range.
- list_dir / tree: explore structure.
- head / tail / wc: quick file inspection.
- git_log / git_blame: history (read-only).

Strategy: search_code first; follow up with grep or read_file only when needed. Cite [path:start-end]. Do not guess.`;

export function buildPrompt(question: string, results: { path: string; symbol: string; start_line: number; end_line: number; snippet: string }[]): Prompt {
  const context = results
    .map((r, i) => {
      const loc = `${r.path}:${r.start_line}-${r.end_line}`;
      const sym = r.symbol ? ` ${r.symbol}` : "";
      return `[${i + 1}] ${loc}${sym}\n${r.snippet}`;
    })
    .join("\n\n");

  const body =
    results.length === 0
      ? `No chunks retrieved.\n\nQuestion: ${question}`
      : `Chunks:\n\n${context}\n\nQuestion: ${question}`;

  return { system: SYSTEM, prompt: body };
}
