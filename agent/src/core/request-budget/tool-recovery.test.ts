import { isLoopFinished, jsonSchema, tool, ToolLoopAgent } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

import { ContextStore } from '../context/store.js';
import { manageContextModel } from './model.js';

it('recovers in a tool loop without executing either completed tool again', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cberg-tool-recovery-'));

  try {
    let step = 0;
    const raw = new MockLanguageModelV4({ doGenerate: async () => {
      step++;
      if (step === 3) throw Object.assign(new Error('maximum context length exceeded'), { code: 'context_length_exceeded' });

      return {
        content: step < 3
          ? [{ type: 'tool-call' as const, toolCallId: `call_${step}`, toolName: 'lookup', input: JSON.stringify({ step }) }]
          : [{ type: 'text' as const, text: 'Done' }],
        finishReason: { unified: step < 3 ? 'tool-calls' as const : 'stop' as const, raw: undefined },
        usage: {
          inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 2, text: 2, reasoning: 0 },
        },
        warnings: [],
      };
    } });
    const execute = vi.fn(async () => 'x'.repeat(6000));
    const loop = new ToolLoopAgent({
      model: manageContextModel(raw, {
        profile: { provider: 'test', modelId: 'test', contextWindow: 8192, cache: 'none' },
        context: ContextStore.open(root),
        summarize: async () => 'Earlier lookup completed; details archived.',
      }),
      tools: { lookup: tool({
        inputSchema: jsonSchema<{ step: number }>({ type: 'object', properties: { step: { type: 'number' } }, required: ['step'] }),
        execute,
      }) },
      stopWhen: isLoopFinished(),
    });

    const result = await loop.generate({ prompt: 'Investigate this' });

    expect(result.text).toBe('Done');
    expect(execute).toHaveBeenCalledTimes(2);
    expect(raw.doGenerateCalls).toHaveLength(4);
    const last = JSON.stringify(raw.doGenerateCalls[3]?.prompt);

    expect(last).toContain('call_2');
    expect(last).toContain('history_file');
    expect(last).not.toContain('call_1');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
