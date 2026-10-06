export function summarizeAttempt(
  attempt: Record<string, unknown>,
  authoritative?: Record<string, unknown>,
) {
  if (attempt !== authoritative) {
    return {
      attempt_id: attempt.attempt_id,
      user_query: attempt.user_query,
      answer: attempt.answer,
      evidence_used: attempt.evidence_used,
    };
  }

  const tools = Array.isArray(attempt.tools_invoked) ? attempt.tools_invoked.filter(isRecord) : [];

  return {
    ...attempt,
    trajectory: undefined,
    retrieved_results: undefined,
    tools_invoked: tools.slice(-10).map((tool) => ({
      name: tool.name,
      input: tool.input,
      output: compactOutput(tool.output, 1_800),
    })),
  };
}

export function compactObservation(value: unknown, maxChars: number): unknown {
  if (!isRecord(value)) return value;

  return {
    ...value,
    excerpt: typeof value.excerpt === 'string' ? value.excerpt.slice(0, maxChars) : undefined,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function compactOutput(value: unknown, maxChars: number): unknown {
  const text = JSON.stringify(value);
  if (!text || text.length <= maxChars) return value;

  return {
    truncated: true,
    opening_excerpt: text.slice(0, maxChars / 2),
    ending_excerpt: text.slice(-maxChars / 2),
  };
}
