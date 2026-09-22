import type { ModelMessage } from 'ai';

/**
 * The readable text of a model message: string content as-is, or the
 * concatenated text parts, ignoring tool-call/tool-result parts. The single
 * definition shared by the agent's history budgeter, the TUI command parser,
 * and session titling — so handling a new content-part type is a one-line edit.
 */
export function messageText(message: ModelMessage): string {
  const { content } = message;
  if (typeof content === 'string') {
    return content;
  }
  return content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

/** JSON-ish rendering of a tool payload. Falls back to String when the value
 *  cannot be serialized (cycles, bigint). */
export function toolOutputText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output == null) return '';
  try {
    const json = JSON.stringify(output, null, 2);
    return json ?? String(output);
  } catch {
    return String(output);
  }
}

/** Text of an ai-sdk tool-result `output` value (text, json, or content parts). */
export function toolResultOutputText(output: unknown): string {
  if (!output || typeof output !== 'object' || !('type' in output)) {
    return toolOutputText(output);
  }
  const typed = output as { type: string; value?: unknown; reason?: string };
  switch (typed.type) {
    case 'text':
    case 'error-text':
      return typeof typed.value === 'string' ? typed.value : toolOutputText(typed.value);
    case 'json':
    case 'error-json':
      return toolOutputText(typed.value);
    case 'execution-denied':
      return typed.reason ?? 'execution denied';
    case 'content':
      if (!Array.isArray(typed.value)) return '';
      return typed.value
        .map((part: { type?: string; text?: string }) => {
          if (part?.type === 'text' && typeof part.text === 'string') return part.text;
          return part?.type ? `[${part.type}]` : '';
        })
        .filter(Boolean)
        .join('\n');
    default:
      return toolOutputText(output);
  }
}

/**
 * Transcript text for one message, including tool calls and tool results.
 * `messageText` drops those parts; compaction and history files need them so
 * a later turn can recover what a tool actually returned.
 */
export function messageTranscript(message: ModelMessage): string {
  const { content } = message;
  if (typeof content === 'string') return content;
  return content
    .map((part) => {
      switch (part.type) {
        case 'text':
        case 'reasoning':
          return part.text;
        case 'tool-call':
          return `tool-call ${part.toolName} ${toolOutputText(part.input)}`;
        case 'tool-result':
          return `tool-result ${part.toolName} ${toolResultOutputText(part.output)}`;
        default:
          return `[${part.type}]`;
      }
    })
    .filter(Boolean)
    .join('\n');
}

/** Index of the last user message, or -1 if none. */
export function lastUserMessageIndex(messages: readonly ModelMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      return i;
    }
  }
  return -1;
}

export function lastUserMessage(messages: readonly ModelMessage[]): ModelMessage | undefined {
  const i = lastUserMessageIndex(messages);
  return i >= 0 ? messages[i] : undefined;
}
