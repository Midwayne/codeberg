import type { ToolSet } from 'ai';

const STREAMING = Symbol.for('codeberg.streamingTool');

/**
 * Mark a tool whose `execute` returns an async iterable of progress values.
 * The AI SDK streams only when that iterable is returned synchronously, so
 * wrappers check this mark instead of awaiting the result. Spreading the
 * definition keeps the mark.
 */
export function streamingTool<T extends ToolSet[string]>(definition: T): T {
  return Object.assign(definition, { [STREAMING]: true });
}

export function isStreamingTool(definition: ToolSet[string] | undefined): boolean {
  return Boolean(definition && (definition as Record<symbol, unknown>)[STREAMING]);
}
