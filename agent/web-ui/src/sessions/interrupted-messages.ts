import { isToolUIPart, type UIMessage } from 'ai';

/** Keep useful partial output, but never show abandoned tools as still running. */
export function interruptedMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => message.role !== 'assistant' ? message : {
    ...message,
    parts: message.parts.flatMap((part): UIMessage['parts'] => {
      if (isToolUIPart(part) && part.state === 'input-streaming') return [];
      if (isToolUIPart(part) && part.state === 'input-available') {
        return [{ ...part, state: 'output-error', errorText: 'Stopped by user.' }];
      }
      if ((part.type === 'text' || part.type === 'reasoning') && part.state === 'streaming') {
        return [{ ...part, state: 'done' }];
      }

      return [part];
    }),
  }).filter((message) => message.role !== 'assistant' || message.parts.length > 0);
}
