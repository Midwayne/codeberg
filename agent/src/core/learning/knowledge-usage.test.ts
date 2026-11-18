import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { KnowledgeUsage } from './knowledge-usage.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('counts each retrieval once per search and keeps the latest time', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codeberg-usage-'));
  roots.push(root);

  const usage = new KnowledgeUsage(root);

  expect(await usage.all()).toEqual({});

  await Promise.all([
    usage.record(['a', 'a', 'b'], '2026-01-01T00:00:00Z'),
    usage.record(['a'], '2026-01-02T00:00:00Z'),
  ]);

  expect(await usage.all()).toEqual({
    a: { count: 2, last_used_at: '2026-01-02T00:00:00Z' },
    b: { count: 1, last_used_at: '2026-01-01T00:00:00Z' },
  });
});
