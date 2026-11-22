import type { UIMessage } from 'ai';

import { sleepingDemo, sleepingDemoParts } from './sleeping';
import { subagentDemoPart } from './subagents';

/** A finished answer with tools, prose, and code so chat styling can be reviewed in the demo. */
export const transcriptChat = {
  id: 'demo-chat-transcript',
  title: 'Where is chunking implemented?',
  createdAt: Date.now() - 120_000,
  updatedAt: Date.now() - 120_000,
};

const question: UIMessage = {
  id: 'demo-transcript-question',
  role: 'user',
  parts: [{ type: 'text', text: 'Where is chunking implemented, and how does it pick chunk boundaries?' }],
};

const searchTool = {
  type: 'dynamic-tool',
  toolName: 'search_code',
  toolCallId: 'demo-search',
  state: 'output-available',
  input: { query: 'chunk boundaries tree-sitter' },
  output: [
    { path: 'core/src/chunk/chunker.c', symbol: 'cberg_chunker_open', start_line: 41, end_line: 88, score: 0.91,
      snippet: 'cberg_chunker *cberg_chunker_open(const cberg_chunker_opts *opts) {\n  /* load grammar, size limits */' },
    { path: 'core/src/chunk/split.c', symbol: 'split_node', start_line: 112, end_line: 164, score: 0.84,
      snippet: 'static int split_node(cberg_chunker *c, TSNode node, size_t depth) {' },
  ],
};

const grepTool = {
  type: 'dynamic-tool',
  toolName: 'grep',
  toolCallId: 'demo-grep',
  state: 'output-available',
  input: { pattern: 'max_chunk_bytes' },
  output: [
    { path: 'core/src/chunk/split.c', line: 118, text: '  if (node_bytes(node) <= c->opts.max_chunk_bytes) {' },
    { path: 'core/include/codeberg/codeberg.h', line: 203, text: '  size_t max_chunk_bytes; /* default 2048 */' },
  ],
};

const answerText = `Chunking lives in **\`core/src/chunk/\`**. The public entry point is \`cberg_chunker_open\` in \`chunker.c\`, and boundary selection happens in \`split_node\`.

## How boundaries are chosen

1. Parse the file with its tree-sitter grammar.
2. Walk top-level nodes; any node under \`max_chunk_bytes\` becomes one chunk.
3. Larger nodes recurse into their children, so functions split at statement blocks rather than mid-line.

\`\`\`c
if (node_bytes(node) <= c->opts.max_chunk_bytes) {
  return emit_chunk(c, node);
}
return split_children(c, node, depth + 1);
\`\`\`

| Option | Default | Effect |
|--------|---------|--------|
| \`max_chunk_bytes\` | 2048 | Upper bound before a node is split |
| \`min_chunk_bytes\` | 64 | Tiny siblings merge into one chunk |

> Files without a grammar fall back to line windows.`;

function answer(): UIMessage {
  return {
    id: 'demo-transcript-answer',
    role: 'assistant',
    parts: sleepingDemo
      ? [searchTool, ...sleepingDemoParts()]
      : [searchTool, grepTool, subagentDemoPart(), { type: 'text', text: answerText }],
  } as unknown as UIMessage;
}

export function transcriptSession() {
  return { ...transcriptChat, messages: [question, answer()] };
}
