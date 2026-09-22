import type { UIMessage } from 'ai';

function turn(id: string, role: UIMessage['role'], text: string): UIMessage {
  return { id, role, parts: [{ type: 'text', text }] };
}

/**
 * Seed conversation for `?preview=rail` (dev only). Tall enough that the tick
 * rail has to map prompts along a scrollable transcript.
 */
export const RAIL_PREVIEW_MESSAGES: UIMessage[] = [
  turn('u1', 'user', 'Where is chunking implemented?'),
  turn(
    'a1',
    'assistant',
    [
      'Chunking lives in the C core, not the TypeScript agent.',
      '',
      '`cberg_chunker_open` in `core/src/chunk/chunker.c` walks a file with the matching tree-sitter grammar and emits semantic chunks (functions, types, modules). The public ABI is `core/include/codeberg/codeberg.h`.',
      '',
      'The indexer (`cberg-index`) calls that chunker as it walks the tree, then writes sidecars the daemon searches. If you are looking for the HTTP surface, `codeberg-d` exposes `find_symbol` / `get_chunk` on top of those records.',
      '',
      'Grammars themselves sit under `core/third_party/grammars/` and are fetched with `make submodules` — they are not vendored by hand.',
    ].join('\n'),
  ),
  turn('u2', 'user', 'How does the daemon talk to the indexer over IPC?'),
  turn(
    'a2',
    'assistant',
    [
      'The daemon supervises `cberg-index` and speaks a length-prefixed JSON protocol over a Unix socket (`CBERG_SOCKET`, default `/tmp/codeberg-index.sock`).',
      '',
      'See `daemon/docs/ipc.md` for the message types: hello, walk, status, and the search RPCs. The Go side is `daemon/internal/index/` — it restarts the indexer if the socket drops, and `/health` stays `ready: false` until the first walk finishes.',
      '',
      'You can watch a live session with `make run-daemon` and `curl -s http://127.0.0.1:8080/health`.',
    ].join('\n'),
  ),
  turn(
    'u3',
    'user',
    'Can you summarize how vector search is wired, including the ONNX model path and what happens when embeddings are skipped?',
  ),
  turn(
    'a3',
    'assistant',
    [
      'Vector search is optional. Core tests and the daemon both run in chunk-only mode when no ONNX model is configured.',
      '',
      'When `CBERG_MODEL` points at `models/jina-embeddings-v2-base-code/model.onnx` (fetch with `scripts/fetch-model.sh`) and ONNX Runtime is on the linker path, `cberg-index` embeds each chunk and writes a usearch index at `CBERG_INDEX_PATH`.',
      '',
      '`CBERG_INDEX_BACKEND` selects `usearch` (default), `qdrant`, or `pgvector`. The HTTP `/search` route then does ANN lookup; without a model it 501s and the agent falls back to lexical tools like `grep` and `find_symbol`.',
      '',
      'A cold embed of this repo is slow on CPU — poll `/health` until `ready` is true before searching.',
    ].join('\n'),
  ),
  turn('u4', 'user', 'And the web chat — where does useChat live?'),
  turn(
    'a4',
    'assistant',
    [
      '`useChat` lives in `ChatSession` inside `Workspace` (`agent/web-ui/src/components/workspace.tsx`). The session id is the React key, so resume, new, and branch remount the chat with that transcript instead of swapping messages under a stale id.',
      '',
      '`Chat` is presentational: it renders the message list, the tick rail, and the prompt input. Each completed turn is PUT to `/api/sessions/<id>` so a reload can resume the same thread.',
    ].join('\n'),
  ),
];
