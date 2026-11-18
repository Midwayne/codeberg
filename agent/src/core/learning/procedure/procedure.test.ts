import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { UIMessage } from 'ai';
import { afterEach, expect, it, vi } from 'vitest';

import { LearningService } from '../service.js';
import { PROCEDURE_SYSTEM } from './prompt.js';

const roots: string[] = [];
const services: LearningService[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) {
    service.stop();
    await service.waitForCurrent();
  }

  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const query =
  'SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.deleted_at IS NULL';

function teaching(): UIMessage[] {
  return [
    {
      id: 'u1',
      role: 'user',
      parts: [
        {
          type: 'text',
          text: 'To find live orders, join orders to customers and always skip deleted customers.',
        },
      ],
    },
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'db_query',
          toolCallId: 't1',
          state: 'output-available',
          input: { sql: query },
          output: { rows: 3 },
        } as UIMessage['parts'][number],
        { type: 'text', text: 'There are 3 live orders.' },
      ],
    },
  ];
}

const plan = {
  action: 'upsert',
  slug: 'count-live-orders',
  title: 'Count live orders',
  when_to_use: 'Questions about current orders.',
  steps: [
    { instruction: 'Query orders joined to customers.', call: 0 },
    { instruction: 'Skip deleted customers.', evidence: 'always skip deleted customers' },
    { instruction: 'Invented step.', evidence: 'something the user never said' },
    { instruction: 'Unknown call.', call: 7 },
  ],
  rules: [{ statement: 'Exclude deleted customers.', evidence: 'skip deleted customers' }],
};

async function setup(response: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'codeberg-procedure-'));
  roots.push(root);

  const generate = vi.fn(async ({ system }: { system: string; prompt: string }) =>
    system === PROCEDURE_SYSTEM ? JSON.stringify(response) : '{"action":"none"}',
  );

  const service = new LearningService({
    root,
    repositories: async () => [],
    generator: { generate },
  });
  services.push(service);

  await service.updateSettings({ profile: false });
  await service.initialize();
  await service.recordSession('c', teaching());

  return { service, generate };
}

it('learns a taught tool-call procedure from a Solved answer and keeps it recallable', async () => {
  const { service } = await setup(plan);

  await service.feedback({ conversationId: 'c', messageId: 'a1', rating: 3, label: 'solved' });
  await service.waitForCurrent();

  const [hit] = await service.store.searchKnowledge('live orders');

  expect(hit.artifact).toMatchObject({
    category: 'procedures',
    slug: 'count-live-orders',
    confidence: 'high',
  });
  expect(hit.artifact.body).toContain('Tool: `db_query`');
  expect(hit.artifact.body).toContain('JOIN customers c ON c.id = o.customer_id');
  expect(hit.artifact.body).toContain('Skip deleted customers.');
  expect(hit.artifact.body).not.toContain('Invented step.');
  expect(hit.artifact.body).not.toContain('Unknown call.');

  expect(await service.knowledgeIndex()).toContain('[[procedures/count-live-orders]]');

  await service.feedback({ conversationId: 'c', messageId: 'a1', rating: 0, label: 'not_useful' });
  await service.waitForCurrent();

  expect(await service.store.searchKnowledge('live orders')).toEqual([]);
});

it('saves nothing for an unrated teaching conversation or a procedure with no grounded step', async () => {
  const { service, generate } = await setup({ ...plan, steps: [plan.steps[2]] });

  expect(generate).not.toHaveBeenCalledWith(expect.objectContaining({ system: PROCEDURE_SYSTEM }));

  await service.feedback({ conversationId: 'c', messageId: 'a1', rating: 3, label: 'solved' });
  await service.waitForCurrent();

  expect(
    (await service.store.knowledgeArtifacts()).filter(
      (artifact) => artifact.category === 'procedures',
    ),
  ).toEqual([]);
});
