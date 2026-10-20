import type { ModelMessage } from 'ai';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { Agent } from './agent.js';
import { DaemonClient, DEFAULT_DAEMON_URL } from './client.js';
import { ContextStore } from './context/store.js';
import { contextTools } from './context/tools.js';

type Execute = (input: Record<string, unknown>, options: unknown) => Promise<string>;

it.skipIf(!process.env.CODEBERG_CONTEXT_BENCH_REPORT)('measures checkpoint reuse and focused large-file access', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cberg-context-improvements-'));
  const samples = [];

  try {
    const file = join(root, 'large.txt');
    const bytes = Number(process.env.CODEBERG_CONTEXT_BENCH_BYTES ?? 50 * 1024 * 1024);
    const content = Buffer.alloc(bytes, `${'x'.repeat(1023)}\n`);
    content.write('needle-at-start\n', 0);
    writeFileSync(file, content);

    for (let trial = 0; trial < 5; trial++) {
      const context = ContextStore.open(join(root, String(trial)));
      const tools = contextTools(ContextStore.open(root));
      const read = tools.context_read!.execute as Execute;
      const grep = tools.context_grep!.execute as Execute;
      let summaryCalls = 0;
      const agent = new Agent({
        model: {} as never,
        daemon: new DaemonClient(DEFAULT_DAEMON_URL),
        learning: false,
        profile: { provider: 'test', modelId: 'test', contextWindow: 2000, cache: 'none' },
        context,
        generator: { generate: async () => {
          summaryCalls++;

          return 'SUMMARY';
        } },
      });
      const messages: ModelMessage[] = Array.from({ length: 40 }, (_, index) => ({
        role: index % 2 ? 'assistant' : 'user',
        content: 'x'.repeat(600),
      }));

      for (let turn = 0; turn < 3; turn++) {
        await agent.compactHistory(messages);
        messages.push({ role: 'user', content: `followup ${turn}` });
        messages.push({ role: 'assistant', content: 'short answer' });
      }

      const readStarted = performance.now();
      expect(await read({ path: file, start_line: 1, end_line: 1 }, {})).toContain('needle-at-start');
      const readMs = performance.now() - readStarted;
      const grepStarted = performance.now();
      expect(await grep({ path: file, pattern: 'needle-at-start', limit: 1 }, {})).toContain('needle-at-start');
      const grepMs = performance.now() - grepStarted;

      samples.push({ summaryCalls, readMs, grepMs });
      await agent.close();
    }

    writeFileSync(process.env.CODEBERG_CONTEXT_BENCH_REPORT!, JSON.stringify(samples));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
