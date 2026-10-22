import { readUIMessageStream, type UIMessage } from 'ai';
import { titleFromText } from '../../core/title.js';
import type { LearningService } from '../../core/learning/service.js';
import type { WebSessionStore } from '../sessions/store.js';
import type { SearchRun } from './types.js';

export async function saveRunSession(sessions: WebSessionStore, run: SearchRun, learning?: LearningService) {
  const messages = await runMessages(run);
  const existing = await sessions.load(run.record.chatId);
  // An older recovered run cannot overwrite a newer turn or resurrect a deleted chat.
  if (!existing || existing.serverRunId !== run.record.id) return;
  if (JSON.stringify(existing.messages) === JSON.stringify(messages)) return;

  const first = messages.find((message) => message.role === 'user');
  const text = first?.parts.filter((part) => part.type === 'text').map((part) => part.text).join(' ') ?? '';
  const record = await sessions.upsert({
    id: run.record.chatId,
    title: existing?.title ?? titleFromText(text, 'New chat'),
    messages,
    serverRunId: run.record.id,
  });
  await learning?.recordSession(record.id, record.messages, record.parentId).catch((error) => {
    console.error('learning session recording failed:', error);
  });
}

async function runMessages(run: SearchRun): Promise<UIMessage[]> {
  const messages = [...run.record.messages];
  let assistant: UIMessage | undefined;
  const stream = new ReadableStream({ start(controller) {
    for (const chunk of run.events) controller.enqueue(chunk);

    controller.close();
  } });
  for await (const message of readUIMessageStream({ stream, onError: () => undefined })) {
    if (message.id) assistant = message;
  }
  if (assistant) messages.push(assistant);

  return messages;
}
