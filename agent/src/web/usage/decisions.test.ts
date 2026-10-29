import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { decisionUsageTracker } from './decisions.js';
import { UsageStore } from './store.js';

it('records decisions under Chat with distinct model attribution and absent counts as unreported', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codeberg-decision-usage-'));
  try {
    const store = new UsageStore(dir);
    const track = decisionUsageTracker(store, { id: 'project', name: 'Project', roots: [] });
    const model = { key: 'openai:fast-decisions', provider: 'openai', model: 'gpt-6-luna', label: 'Decisions',
      api: 'openai' as const, endpoint: 'https://example.test/decisions', apiKeyEnv: 'OPENAI_API_KEY' };
    await track(model, { input_tokens: 50, output_tokens: 0,
      input_tokens_details: { cached_tokens: 30, cache_write_tokens: 10 } });
    await track(model, undefined);
    const rows = await store.read('2020-01-01', '2100-01-01');

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.kind === 'chat' && row.project === 'project' && row.key === model.key)).toBe(true);
    expect(rows.map((row) => row.inputTokens).sort()).toEqual([50, null].sort());
    expect(rows.map((row) => row.outputTokens).sort()).toEqual([0, null].sort());
    const recorded = rows.find((row) => row.inputTokens !== null)!;
    expect(recorded.inputTokens).toBe(50);
    expect(recorded.cacheReadTokens).toBe(30);
    expect(recorded.cacheWriteTokens).toBe(10);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
