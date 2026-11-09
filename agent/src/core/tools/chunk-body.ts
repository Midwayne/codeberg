export type ChunkBody = { body: string; truncated: boolean };

/** The body of a `get_chunk` result. Callers keep their own size budgets. */
export function readChunkBody(detail: unknown): ChunkBody | undefined {
  if (!detail || typeof detail !== 'object' || !('body' in detail)) return undefined;

  if (typeof detail.body !== 'string') return undefined;

  return {
    body: detail.body,
    truncated: 'truncated' in detail && detail.truncated === true,
  };
}
