import type { ModelMessage, ToolLoopAgent } from 'ai';
import { describe, expect, it, vi } from 'vitest';

import { wrapToolLoopAgentWithCompaction } from './compaction.js';

describe('wrapToolLoopAgentWithCompaction', () => {
  it('compacts the prompt before delegating to stream', async () => {
    let seen: ModelMessage[] | undefined;
    const loop = {
      stream: async (p: { prompt: ModelMessage[] }) => {
        seen = p.prompt;

        return { fullStream: [] };
      },
    } as unknown as ToolLoopAgent;

    const compact = vi.fn(async () => [{ role: 'user', content: 'compacted' } as ModelMessage]);

    const wrapped = wrapToolLoopAgentWithCompaction(loop, compact);
    await wrapped.stream({
      prompt: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
      ],
    } as never);

    expect(compact).toHaveBeenCalledOnce();
    expect(seen).toEqual([{ role: 'user', content: 'compacted' }]);
  });
});
