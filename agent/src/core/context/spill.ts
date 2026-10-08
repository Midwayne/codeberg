import { toolOutputText } from '../message.js';
import { isSpillPreview } from './spill-preview.js';
import type { ContextStore } from './store.js';

export { isSpillPreview, spillResultCount } from './spill-preview.js';

/** Tool results longer than this are written to a file. The model sees a
 *  head/tail preview and the path, so the middle is recoverable without
 *  occupying the context window. */
export const SPILL_CHARS = 12_000;
export const SPILL_HEAD_CHARS = 2_000;
export const SPILL_TAIL_CHARS = 1_500;

const TERMINAL_TOOLS = new Set(['pipe', 'shell', 'bash', 'terminal']);

/** Head/tail preview that names the file holding the full output. */
export function spillPreview(
  file: string,
  text: string,
  headChars = SPILL_HEAD_CHARS,
  tailChars = SPILL_TAIL_CHARS,
  resultCount?: number,
): string {
  const count = resultCount == null ? '' : `; result_count=${resultCount}`;

  return [
    `[spilled to ${file} — ${text.length} chars${count}; the middle is only in that file]`,
    '<head>',
    text.slice(0, headChars),
    '</head>',
    '<tail>',
    text.slice(-tailChars),
    '</tail>',
    'Use context_grep or context_read on that file before answering from the omitted middle.',
  ].join('\n');
}

/**
 * Write `text` and return the preview the model should see. Returns undefined
 * when the text is short enough to keep inline, or is already a preview.
 */
export async function spillText(
  store: ContextStore,
  toolName: string,
  text: string,
  limit = SPILL_CHARS,
  resultCount?: number,
): Promise<string | undefined> {
  if (text.length <= limit || isSpillPreview(text)) return undefined;

  const file = await store.writeToolOutput(toolName, text);

  return spillPreview(file, text, SPILL_HEAD_CHARS, SPILL_TAIL_CHARS, resultCount);
}

/** Append pipe/shell output to the terminal log. Other tools are ignored. */
export async function recordTerminal(
  store: ContextStore,
  toolName: string,
  args: unknown,
  text: string,
): Promise<void> {
  if (!TERMINAL_TOOLS.has(toolName)) return;

  await store.appendTerminal(toolName, args, text);
}

/**
 * Characters the provider actually sends for `output`. Structured results go
 * over the wire as compact JSON, so judging them by the indented rendering
 * (about a third larger) would spill results that fit and cost the model an
 * extra context_read round trip.
 */
export function wireChars(output: unknown): number {
  if (typeof output === 'string') return output.length;

  if (output == null) return 0;

  try {
    return (JSON.stringify(output) ?? String(output)).length;
  } catch {
    return String(output).length;
  }
}

/**
 * What the model should see for one freshly executed tool. Short results pass
 * through. Long ones are replaced with a preview. Terminal tools are logged
 * here, at execute time; a resumed transcript is not logged again.
 */
export async function presentToolOutput(
  store: ContextStore,
  toolName: string,
  args: unknown,
  output: unknown,
  limit = SPILL_CHARS,
): Promise<unknown> {
  const text = toolOutputText(output);
  try {
    await recordTerminal(store, toolName, args, text);
    if (wireChars(output) <= limit) return output;

    const preview = await spillText(
      store,
      toolName,
      text,
      limit,
      Array.isArray(output) ? output.length : undefined,
    );

    return preview ?? output;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`› context: failed to spill ${toolName}: ${message}`);

    return output;
  }
}
