import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { capturesKnowledge } from './knowledge-feedback.js';
import { LearningService } from './service.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('treats solved and mostly correct ratings as confirmation for knowledge', () => {
  expect(capturesKnowledge('solved')).toBe(true);
  expect(capturesKnowledge('mostly_correct')).toBe(true);

  expect(capturesKnowledge('partially_useful')).toBe(false);
  expect(capturesKnowledge('not_useful')).toBe(false);
  expect(capturesKnowledge(undefined)).toBe(false);
});

it('queues knowledge extraction for a mostly correct rating but not a partially useful one', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codeberg-knowledge-feedback-'));
  roots.push(root);

  const service = new LearningService({ root });

  await service.recordSession('c', [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Where is checkout?' }] },
    { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'In src/checkout.ts.' }] },
  ]);

  const partial = await service.feedback({
    conversationId: 'c',
    messageId: 'a1',
    rating: 1,
    label: 'partially_useful',
  });

  expect(partial.jobId).toBeUndefined();

  const mostly = await service.feedback({
    conversationId: 'c',
    messageId: 'a1',
    rating: 2,
    label: 'mostly_correct',
  });

  expect(mostly.jobId).toBeDefined();

  service.stop();
  await service.waitForCurrent();
});
