import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { AttemptRecord, FeedbackRecord, LearningEvent } from '../types.js';
import { readEvents } from './events.js';
import { effectiveFeedback } from './feedback.js';
import type { ConversationFeedbackIndex, LearningStoreState } from './state.js';

/** Current rating of each rated answer in a conversation, keyed by assistant message id. */
export async function conversationFeedback(
  state: LearningStoreState,
  conversationId: string,
): Promise<Map<string, FeedbackRecord>> {
  const index = await feedbackIndex(state);

  return new Map(index.get(conversationId));
}

async function feedbackIndex(state: LearningStoreState): Promise<ConversationFeedbackIndex> {
  const version = await eventsVersion(state);
  const cached = state.feedbackIndex;
  if (cached?.version === version) return cached.index;

  // Concurrent lookups share one parse of the event log.
  const index = readEvents(state).then(indexFeedback);
  state.feedbackIndex = { version, index };

  index.catch(() => {
    if (state.feedbackIndex?.index === index) state.feedbackIndex = undefined;
  });

  return index;
}

/** Appends from this or another process change a file's size or mtime. */
async function eventsVersion(state: LearningStoreState): Promise<string> {
  const directory = join(state.root, 'events');
  const files = await readdir(directory).catch(() => [] as string[]);

  const identities = await Promise.all(
    files
      .filter((file) => file.endsWith('.jsonl'))
      .sort()
      .map(async (file) => {
        const info = await stat(join(directory, file), { bigint: true }).catch(() => undefined);

        return info ? `${file}:${info.ino}:${info.size}:${info.mtimeNs}` : `${file}:missing`;
      }),
  );

  return identities.join('\n');
}

/** Mirrors `attemptForMessage` + `currentFeedback` for every message at once. */
function indexFeedback(events: LearningEvent[]): ConversationFeedbackIndex {
  const current = effectiveFeedback(events);
  const index: ConversationFeedbackIndex = new Map();

  for (const attempt of latestAttemptPerMessage(events)) {
    const feedback = current.get(attempt.attempt_id);
    if (!feedback) continue;

    const messages = index.get(attempt.conversation_id) ?? new Map<string, FeedbackRecord>();
    messages.set(attempt.assistant_message_id, feedback);
    index.set(attempt.conversation_id, messages);
  }

  return index;
}

function latestAttemptPerMessage(events: LearningEvent[]): Iterable<AttemptRecord> {
  const byId = new Map<string, AttemptRecord>();
  for (const event of events) {
    if (event.type === 'attempt_recorded') byId.set(event.attempt.attempt_id, event.attempt);
  }

  const latest = new Map<string, AttemptRecord>();
  for (const attempt of byId.values()) {
    latest.set(`${attempt.conversation_id}\0${attempt.assistant_message_id}`, attempt);
  }

  return latest.values();
}
