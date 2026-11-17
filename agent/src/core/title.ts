import type { UIMessage } from 'ai';

/** Build a short session title from free-form text. */
export function titleFromText(text: string, empty = 'New chat'): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) {
    return empty;
  }

  return clean.length > 60 ? `${clean.slice(0, 59)}…` : clean;
}

/** Title a chat by the text of its first user message. */
export function titleFromMessages(messages: readonly UIMessage[]): string {
  const first = messages.find((message) => message.role === 'user');
  const text = (first?.parts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join(' ');

  return titleFromText(text, 'New chat');
}
