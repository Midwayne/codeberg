import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import { externalizeToolResults } from './externalize.js';
import { SPILL_CHARS } from './spill.js';
import { ContextStore } from './store.js';

describe('externalizeToolResults', () => {
  it('returns the same array when every tool result is small', async () => {
    const store = ContextStore.open(mkdtempSync(join(tmpdir(), 'cberg-ext-')));
    const messages: ModelMessage[] = [
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: '1',
            toolName: 'grep',
            output: { type: 'text', value: 'short' },
          },
        ],
      },
    ];
    const out = await externalizeToolResults(messages, store);
    expect(out).toBe(messages);
  });

  it('replaces an oversized tool result with a preview that points at the file', async () => {
    const store = ContextStore.open(mkdtempSync(join(tmpdir(), 'cberg-ext-')));
    const value = 'q'.repeat(SPILL_CHARS + 20);
    const messages: ModelMessage[] = [
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: '1',
            toolName: 'read_file',
            output: { type: 'text', value },
          },
        ],
      },
    ];
    const out = await externalizeToolResults(messages, store);
    expect(out).not.toBe(messages);
    const part = out[0]?.role === 'tool' ? out[0].content[0] : undefined;
    expect(part?.type).toBe('tool-result');
    if (part?.type !== 'tool-result' || part.output.type !== 'text') {
      throw new Error('expected a text tool result');
    }
    expect(part.output.value).toContain('[spilled to ');
    expect(part.output.value).toContain('read_file-1.txt');
  });
});
