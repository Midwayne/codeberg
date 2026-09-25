import type { AssistantContent, ModelMessage, ToolContent, ToolResultPart, UserContent } from 'ai';

/** ai-sdk tool-result payload. Not re-exported from `ai`; it is the `output` of a tool-result part. */
type ToolResultOutput = ToolResultPart['output'];
type ToolResultContentPart = Extract<ToolResultOutput, { type: 'content' }>['value'][number];
type UserPart = Exclude<UserContent, string>[number];
type AssistantPart = Exclude<AssistantContent, string>[number];
type ToolPart = ToolContent[number];

/**
 * The readable text of a model message: string content as-is, or the
 * concatenated text parts, ignoring tool-call/tool-result parts. The single
 * definition shared by the agent's history budgeter,
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
export function toolResultOutputText(output: ToolResultOutput): string {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return output.value;
    case 'json':
    case 'error-json':
      return toolOutputText(output.value);
    case 'execution-denied':
      return output.reason ?? 'execution denied';
    case 'content':
      return output.value.map(contentPartText).filter(Boolean).join('\n');
    default: {
      const _never: never = output;
      return _never;
    }
  }
}

function contentPartText(part: ToolResultContentPart): string {
  switch (part.type) {
    case 'text':
      return part.text;
    case 'file':
    case 'file-data':
    case 'file-url':
    case 'file-id':
    case 'file-reference':
    case 'image-data':
    case 'image-url':
    case 'image-file-id':
    case 'image-file-reference':
      return '[file]';
    case 'custom':
      return '[custom]';
    default: {
      const _never: never = part;
      return _never;
    }
  }
}

/**
 * Transcript text for one message, including tool calls and tool results.
 * `messageText` drops those parts; compaction and history files need them so
 * a later turn can recover what a tool actually returned.
 */
export function messageTranscript(message: ModelMessage): string {
  switch (message.role) {
    case 'system':
      return message.content;
    case 'user':
      return joinParts(message.content, userPartText);
    case 'assistant':
      return joinParts(message.content, assistantPartText);
    case 'tool':
      return message.content.map(toolPartText).filter(Boolean).join('\n');
    default: {
      const _never: never = message;
      return _never;
    }
  }
}

function joinParts<T>(content: string | readonly T[], render: (part: T) => string): string {
  if (typeof content === 'string') return content;
  return content.map(render).filter(Boolean).join('\n');
}

function userPartText(part: UserPart): string {
  switch (part.type) {
    case 'text':
      return part.text;
    case 'image':
    case 'file':
      return '[file]';
    default: {
      const _never: never = part;
      return _never;
    }
  }
}

function assistantPartText(part: AssistantPart): string {
  switch (part.type) {
    case 'text':
    case 'reasoning':
      return part.text;
    case 'file':
    case 'reasoning-file':
      return '[file]';
    case 'custom':
      return '[custom]';
    case 'tool-call':
      return `tool-call ${part.toolName} ${toolOutputText(part.input)}`;
    case 'tool-result':
      return `tool-result ${part.toolName} ${toolResultOutputText(part.output)}`;
    case 'tool-approval-request':
      return '[tool-approval-request]';
    default: {
      const _never: never = part;
      return _never;
    }
  }
}

function toolPartText(part: ToolPart): string {
  switch (part.type) {
    case 'tool-result':
      return `tool-result ${part.toolName} ${toolResultOutputText(part.output)}`;
    case 'tool-approval-response':
      return '[tool-approval-response]';
    default: {
      const _never: never = part;
      return _never;
    }
  }
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
