import { toolOutputText } from '../message.js';
import type { ContextStore } from './store.js';

/** Tool results longer than this are written to a file. The model sees a
 *  head/tail preview and the path, so the middle is recoverable without
 *  occupying the context window. */
export const SPILL_CHARS = 12_000;
export const SPILL_HEAD_CHARS = 2_000;
export const SPILL_TAIL_CHARS = 1_500;

const TERMINAL_TOOLS = new Set(['pipe', 'shell', 'bash', 'terminal']);

export function isSpillPreview(text: string): boolean {
  return text.startsWith('[spilled to ');
}

/** Head/tail preview that names the file holding the full output. */
export function spillPreview(
  file: string,
  text: string,
  headChars = SPILL_HEAD_CHARS,
  tailChars = SPILL_TAIL_CHARS,
): string {
  return [
    `[spilled to ${file} — ${text.length} chars; the middle is only in that file]`,
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
 * What the model should see for one tool result. Short results pass through.
 * Long ones are replaced with a preview. Pipe/shell output is always appended
 * to the terminal log so a later turn can grep it after the result is pruned.
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
    if (TERMINAL_TOOLS.has(toolName)) {
      await store.appendTerminal(toolName, args, text);
    }
    if (text.length <= limit || isSpillPreview(text)) return output;
    const file = await store.writeToolOutput(toolName, text);
    return spillPreview(file, text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`› context: failed to spill ${toolName}: ${message}`);
    return output;
  }
}
