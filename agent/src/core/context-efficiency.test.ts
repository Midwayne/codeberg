import type { ModelMessage } from 'ai';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { Agent } from './agent.js';
import { DaemonClient, DEFAULT_DAEMON_URL } from './client.js';
import { ContextStore } from './context/store.js';
import { fitHistory, totalTokens } from './history.js';

function outputFixture(): ModelMessage[] {
  return [
    ...Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 ? 'assistant' as const : 'user' as const,
      content: 'x'.repeat(100),
    })),
    { role: 'user', content: 'Find the implementation' },
    {
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'read', toolName: 'read_file', input: { path: 'src/code.ts' } },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'read',
          toolName: 'read_file',
          output: { type: 'text', value: 'source\n'.repeat(10000) },
        },
      ],
    },
    { role: 'assistant', content: 'Found src/code.ts' },
  ];
}

it('measures five identical context fixtures without provider calls', async () => {
  const samples = [];

  for (let trial = 0; trial < 5; trial++) {
    const root = mkdtempSync(join(tmpdir(), 'cberg-context-bench-'));
    let calls = 0;

    const agent = new Agent({
      model: {} as never,
      daemon: new DaemonClient(DEFAULT_DAEMON_URL),
      learning: false,
      profile: { provider: 'test', modelId: 'test', contextWindow: 12000, cache: 'none' },
      context: ContextStore.open(root),
      generator: {
        generate: async () => {
          calls++;

          return 'SUMMARY';
        },
      },
    });

    try {
      const messages = outputFixture();
      const output = await agent.compactHistory(messages);
      const longHistory: ModelMessage[] = Array.from({ length: 12 }, (_, i) => ({
        role: i % 2 ? 'assistant' : 'user',
        content: 'x'.repeat(600),
      }));
      const fitted = await fitHistory(longHistory, { budget: 1000, summarize: async () => 'SUMMARY' });

      samples.push({
        input: totalTokens(messages),
        output: totalTokens(output),
        summaryCalls: calls,
        textInput: totalTokens(longHistory),
        textOutput: totalTokens(fitted),
      });
    } finally {
      await agent.close();
      rmSync(root, { recursive: true, force: true });
    }
  }

  const report = process.env.CODEBERG_CONTEXT_BENCH_REPORT;
  if (report) writeFileSync(report, JSON.stringify(samples));

  expect(samples.map((sample) => sample.summaryCalls)).toEqual([0, 0, 0, 0, 0]);
  expect(samples.every((sample) => sample.textOutput < 400)).toBe(true);
});
