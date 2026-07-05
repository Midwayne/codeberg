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
