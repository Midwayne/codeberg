/** What search_code is for, with example queries so exact names go to the precise tools. */
export const SEARCH_CODE_DESCRIPTION =
  'Semantic code search. Returns relevant chunks with path, lines, snippet, and bounded full bodies for the top hits. ' +
  'Start here for conceptual questions. Searches every indexed repo unless `repo` narrows it to one ' +
  '(keys via the repos tool); `path_glob`, `kind`, and `min_score` narrow further. ' +
  'Good queries describe behavior: "where expired sessions are cleaned up", "how retries are configured for outbound HTTP". ' +
  'Use other tools for exact names: "UserService.save" → find_symbol; "callers of parseConfig" → search_graph and trace_path; "TODO" → grep.';
