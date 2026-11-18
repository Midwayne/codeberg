import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { evidenceRefs } from '../memory-source.js';
import { locateQuote } from '../quote.js';
import { LearningService } from '../service.js';
import type { AttemptRecord } from '../types.js';

const roots: string[] = [];
const services: LearningService[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) {
    service.stop();
    await service.waitForCurrent();
  }

  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup(generate: (input: { system: string; prompt: string }) => Promise<string>) {
  const root = await mkdtemp(join(tmpdir(), 'codeberg-confirmed-'));
  roots.push(root);

  const repo = join(root, 'billing');
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, 'src', 'Invoice.ts'), 'export const due = total - credits;\n');

  let commit = 'commit-A';
  const repositories = async () => [{ path: repo, commit }];

  const service = new LearningService({
    root: join(root, 'learning'),
    repositories,
    generator: { generate: vi.fn(generate) },
  });
  services.push(service);

  await service.updateSettings({ profile: false });
  await service.initialize();

  await service.recordSession('c', [
    {
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: 'How is the invoice due amount computed?' }],
    },
    {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Due is the total minus credits.' }],
    },
  ]);

  const rate = async (rating: 0 | 2 | 3, label: 'not_useful' | 'mostly_correct' | 'solved') => {
    await service.feedback({ conversationId: 'c', messageId: 'a1', rating, label });
    await service.waitForCurrent();
  };

  return { service, rate, setCommit: (value: string) => (commit = value) };
}

it('keeps a Solved answer the model could not ground as a low-confidence finding', async () => {
  const { service, rate, setCommit } = await setup(
    async () => '{"action":"none","reason":"no quote"}',
  );

  await rate(3, 'solved');

  const [saved] = await service.store.searchKnowledge('invoice due amount');

  expect(saved.artifact).toMatchObject({ confidence: 'low', status: 'active', claims: [] });
  expect(saved.artifact.body).toContain('not source-verified');
  expect(saved.artifact.body).toContain('Due is the total minus credits.');

  setCommit('commit-B');

  expect(await service.store.searchKnowledge('invoice due amount')).toHaveLength(1);

  await rate(0, 'not_useful');

  expect(await service.store.searchKnowledge('invoice due amount')).toEqual([]);
});

it('does not keep an ungrounded Mostly correct answer', async () => {
  const { service, rate } = await setup(async () => '{"action":"none"}');

  await rate(2, 'mostly_correct');

  expect(await service.store.knowledgeArtifacts()).toEqual([]);
});

it('counts files the agent read as evidence even when the answer does not name them', () => {
  const attempt = {
    answer: 'Due is the total minus credits.',
    repositories: [{ path: '/repos/billing' }],
    evidence_used: [],
    files_inspected: ['src/Invoice.ts', 'src/Unrelated.ts'],
    retrieved_results: [
      { tool: 'grep', rank: 1, path: 'src/Unrelated.ts' },
      { tool: 'read_file', rank: 1, path: 'src/Invoice.ts' },
    ],
  } as unknown as AttemptRecord;

  expect(evidenceRefs(attempt).map((ref) => ref.path)).toEqual([
    'src/Invoice.ts',
    'src/Unrelated.ts',
  ]);
});

it('matches quotes that differ only in whitespace and returns the exact source span', () => {
  const source =
    'export function due(total: number,\n    credits: number) {\n  return total - credits;\n}';

  expect(locateQuote(source, 'return total - credits;')).toBe('return total - credits;');
  expect(locateQuote(source, 'due(total: number, credits: number)')).toBe(
    'due(total: number,\n    credits: number)',
  );
  expect(locateQuote(source, 'return total + credits;')).toBeUndefined();
});
