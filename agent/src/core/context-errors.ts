const OVERFLOW_CODE = /^(context_length_exceeded|context_window_exceeded|prompt_too_long|max_context_length|input_too_long)$/;
const OVERFLOW_MESSAGE = /maximum context length|context (window|length).*(exceed|limit|too (large|long))|prompt is too long|too many input tokens|input tokens?.*(exceed|limit)|(request|prompt|input).*exceed.*context (size|window|length)/i;

/** Provider context rejections are distinct from auth, rate limits and aborts. */
export function isContextOverflow(error: unknown): boolean {
  return overflowAt(error, 0);
}

function overflowAt(error: unknown, depth: number): boolean {
  if (depth >= 5 || !error) return false;

  if (typeof error === 'string') return OVERFLOW_MESSAGE.test(error);

  if (typeof error !== 'object') return false;

  const value = error as Record<string, unknown>;
  if (value.name === 'AbortError' || [401, 403, 429].includes(Number(value.statusCode))) return false;

  if (OVERFLOW_CODE.test(String(value.code ?? '')) || OVERFLOW_MESSAGE.test(String(value.message ?? ''))) return true;

  for (const key of ['cause', 'error', 'data']) {
    if (value[key] !== value && overflowAt(value[key], depth + 1)) return true;
  }

  if (typeof value.responseBody === 'string' && value.responseBody.length < 65536) {
    try {
      return overflowAt(JSON.parse(value.responseBody), depth + 1);
    } catch {
      // Non-JSON response bodies do not establish a context-limit rejection.
    }
  }

  return false;
}

export class IncompleteSummaryError extends Error {
  constructor() {
    super('The model returned an incomplete summary.');
    this.name = 'IncompleteSummaryError';
  }
}
