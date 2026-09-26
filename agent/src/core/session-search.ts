import type { UIMessage } from 'ai';

/** Only conversational text is indexed; tool payloads and reasoning stay out of search. */
export interface MessageSearchHit {
  messageId: string;
  role: 'assistant' | 'user';
  snippet: string;
}

export function messageSearchHits(messages: readonly UIMessage[], query: string): MessageSearchHit[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const hits: MessageSearchHit[] = [];
  for (const [index, message] of messages.entries()) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const text = message.parts
      .filter((part): part is Extract<UIMessage['parts'][number], { type: 'text' }> => part.type === 'text')
      .map((part) => part.text).join(' ');
    const at = text.toLocaleLowerCase().indexOf(needle);
    if (at < 0) continue;
    const start = Math.max(0, at - 55);
    const end = Math.min(text.length, at + needle.length + 95);
    hits.push({
      messageId: message.id || `${message.role}-${index}`,
      role: message.role,
      snippet: `${start ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`,
    });
  }
  return hits;
}
