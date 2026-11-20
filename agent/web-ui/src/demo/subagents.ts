/** A run_subagents call for the demo transcript; `?subagents=live` shows it mid-run. */
export function subagentDemoPart() {
  const live = new URLSearchParams(location.search).get('subagents') === 'live';

  return {
    type: 'dynamic-tool',
    toolName: 'run_subagents',
    toolCallId: 'demo-subagents',
    state: 'output-available',
    ...(live ? { preliminary: true } : {}),
    input: { tasks: briefs },
    output: { results: live ? running : finished },
  };
}

const briefs = [
  { description: 'Map chunk boundary rules', prompt: 'Read core/src/chunk/split.c and explain how split_node decides where a chunk ends. Return the rules with line ranges.' },
  { description: 'Check grammar fallback', prompt: 'Find what happens when a file has no tree-sitter grammar. Return the code path and the window size.' },
  { description: 'Survey chunk size tests', prompt: 'List the tests that cover max_chunk_bytes and min_chunk_bytes, and what each asserts.' },
];

const base = (index: number) => ({
  agent_id: `sa_demo${index}`,
  description: briefs[index]!.description,
  agent_type: 'explorer',
});

const running = [
  { ...base(0), status: 'completed', tool_calls: 3, steps: 4, elapsed_ms: 9_400,
    report: 'Nodes under `max_chunk_bytes` become one chunk (`split.c:118-121`); larger nodes recurse into children.' },
  { ...base(1), status: 'running', tool_calls: 2, steps: 3, started_at: Date.now() - 7_100, activity: 'grep · line_window' },
  { ...base(2), status: 'queued', tool_calls: 0 },
];

const finished = [
  { ...running[0]!, usage: { input_tokens: 8_200, output_tokens: 410 }, transcript: '/demo/context/subagents/sa_demo0.json' },
  { ...base(1), status: 'completed', tool_calls: 4, steps: 5, elapsed_ms: 12_800,
    usage: { input_tokens: 9_900, output_tokens: 380 }, transcript: '/demo/context/subagents/sa_demo1.json',
    report: 'Files without a grammar use 40-line windows with a 5-line overlap (`fallback.c:22-57`).' },
  { ...base(2), status: 'incomplete', tool_calls: 15, steps: 16, elapsed_ms: 41_000,
    usage: { input_tokens: 31_000, output_tokens: 620 }, transcript: '/demo/context/subagents/sa_demo2.json',
    report: '`test_chunker.c` covers both limits; `test_split.c` was not checked before the step limit.' },
];
