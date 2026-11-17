import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { UIMessage } from 'ai';
import { afterEach, describe, expect, it } from 'vitest';

import { LearningStore } from '../store.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function store(): Promise<LearningStore> {
  const root = await mkdtemp(join(tmpdir(), 'codeberg-feedback-'));
  roots.push(root);

  return new LearningStore(root);
}

function answer(id: string, text: string): UIMessage[] {
  return [
    { id: `u-${id}`, role: 'user', parts: [{ type: 'text', text: `Question for ${id}?` }] },
    { id, role: 'assistant', parts: [{ type: 'text', text }] },
  ];
}

async function attemptFor(learning: LearningStore, conversationId: string, messageId: string) {
  const attempt = await learning.attemptForMessage(conversationId, messageId);
  if (!attempt) throw new Error(`missing attempt for ${messageId}`);

  return attempt;
}

describe('conversation feedback', () => {
  it('returns the current rating of every rated answer in one conversation', async () => {
    const learning = await store();
    await learning.recordSession('chat-a', [...answer('a1', 'First.'), ...answer('a2', 'Second.')]);
    await learning.recordSession('chat-b', answer('b1', 'Other chat.'));

    const first = await attemptFor(learning, 'chat-a', 'a1');
    const other = await attemptFor(learning, 'chat-b', 'b1');
    await learning.recordFeedback({ attemptId: first.attempt_id, rating: 3, label: 'solved' });
    await learning.recordFeedback({ attemptId: first.attempt_id, rating: 1, label: 'partially_useful' });
    await learning.recordFeedback({ attemptId: other.attempt_id, rating: 0, label: 'not_useful' });

    const feedback = await learning.conversationFeedback('chat-a');

    expect([...feedback.keys()]).toEqual(['a1']);
    expect(feedback.get('a1')?.label).toBe('partially_useful');
  });

  it('follows the latest answer when a regenerated reply reuses its message id', async () => {
    const learning = await store();
    await learning.recordSession('chat-a', answer('a1', 'Original answer.'));
    const original = await attemptFor(learning, 'chat-a', 'a1');
    await learning.recordFeedback({ attemptId: original.attempt_id, rating: 3, label: 'solved' });

    await learning.recordSession('chat-a', answer('a1', 'Regenerated answer.'));

    expect((await learning.conversationFeedback('chat-a')).has('a1')).toBe(false);
  });

  it('sees ratings written after an earlier lookup, including by another process', async () => {
    const learning = await store();
    await learning.recordSession('chat-a', answer('a1', 'First.'));
    expect((await learning.conversationFeedback('chat-a')).size).toBe(0);

    const attempt = await attemptFor(learning, 'chat-a', 'a1');
    const solved = await learning.recordFeedback({ attemptId: attempt.attempt_id, rating: 3, label: 'solved' });
    expect((await learning.conversationFeedback('chat-a')).get('a1')?.label).toBe('solved');

    const later = new Date(Date.now() + 1_000).toISOString();
    const external = {
      event_id: 'external-event',
      type: 'feedback_recorded',
      timestamp: later,
      feedback: { ...solved, feedback_id: 'external', rating: 0, label: 'not_useful', timestamp: later },
    };
    const day = new Date().toISOString().slice(0, 10);
    await appendFile(join(learning.root, 'events', `${day}.jsonl`), `${JSON.stringify(external)}\n`, 'utf8');

    expect((await learning.conversationFeedback('chat-a')).get('a1')?.label).toBe('not_useful');
  });
});
