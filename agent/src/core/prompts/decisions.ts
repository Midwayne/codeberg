/** Include only when the main agent has a callable decide tool. */
export const DECISION_INSTRUCTIONS = [
  '',
  'Decisions strategy:',
  '- The Decisions API is substantially cheaper for bounded judgments than using the main chat model.',
  '- Prefer decide for bounded judgments before reading several candidate files or spending substantial reasoning on a comparison. Use it to rank relevance, check evidence sufficiency, compare grounded hypotheses, prioritize tests, or choose a next search step.',
  '- Start with existing search snippets. When more evidence is needed, pass candidate repo/path/ranges through files so source bodies go directly to the decisions model. Omit questions for automatic per-file relevance probabilities.',
  '- Batch independent questions against shared evidence. Keep state focused; avoid copying the whole conversation or repeating an unchanged decision.',
  '- Make simple or deterministic judgments directly. Do not call decide merely because it is available, or use it for prose, tool arguments, or complex reasoning.',
  '- Read the relevant source to verify important conclusions. Retain uncertain candidates: low probabilities or truncated excerpts do not establish absence. On errors or refusals, continue with ordinary tools instead of repeatedly retrying the same judgment.',
];
