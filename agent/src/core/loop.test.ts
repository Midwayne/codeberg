import type { ModelMessage, ToolLoopAgent } from 'ai';
import { describe, expect, it, vi } from 'vitest';

import { overrideLoopMethods, withMessageTransforms, type MessageTransform } from './loop.js';

describe('overrideLoopMethods', () => {
  it('swaps stream and passes everything else through bound to the loop', async () => {
    const loop = {
      stream: async () => ({ tag: 'real-stream' }),
      generate: async () => ({ tag: 'real-generate' }),
      tools: { a: 1 },
      get id() {
        return 'loop-id';
      },
    } as unknown as ToolLoopAgent;

    const wrapped = overrideLoopMethods(loop, {
      stream: (async () => ({ tag: 'override' })) as never,
    });

    expect(await (wrapped.stream as never as () => Promise<unknown>)()).toEqual({
      tag: 'override',
    });
    // non-overridden method passes through
    expect(await (wrapped.generate as never as () => Promise<unknown>)()).toEqual({
      tag: 'real-generate',
    });
    // non-function property passes through
    expect((wrapped as unknown as { tools: unknown }).tools).toEqual({ a: 1 });
    expect((wrapped as unknown as { id: string }).id).toBe('loop-id');
  });

  it('returns the loop untouched when there are no overrides', () => {
    const loop = {} as ToolLoopAgent;
    expect(overrideLoopMethods(loop, {})).toBe(loop);
  });
});

describe('withMessageTransforms', () => {
  function captureLoop() {
    const calls: { method: string; messages: ModelMessage[] }[] = [];
    const loop = {
      stream: async (p: { prompt: ModelMessage[] }) => {
        calls.push({ method: 'stream', messages: p.prompt });
        return { ok: true };
      },
      generate: async (p: { messages: ModelMessage[] }) => {
        calls.push({ method: 'generate', messages: p.messages });
        return { ok: true };
      },
    } as unknown as ToolLoopAgent;
    return { loop, calls };
  }

  it('runs transforms in order on an array prompt (stream)', async () => {
    const { loop, calls } = captureLoop();
    const t1: MessageTransform = (m) => [...m, { role: 'user', content: '1' }];
    const t2: MessageTransform = async (m) => [...m, { role: 'user', content: '2' }];

    const wrapped = withMessageTransforms(loop, [t1, t2]);
    await wrapped.stream({ prompt: [{ role: 'user', content: '0' }] } as never);

    expect(calls[0]!.messages.map((m) => m.content)).toEqual(['0', '1', '2']);
  });

  it('runs transforms on generate messages', async () => {
    const { loop, calls } = captureLoop();
    const wrapped = withMessageTransforms(loop, [
      async () => [{ role: 'user', content: 'fitted' }],
    ]);
    await wrapped.generate({
      messages: [{ role: 'user', content: 'x' }],
    } as never);
    expect(calls[0]!.messages).toEqual([{ role: 'user', content: 'fitted' }]);
  });

  it('leaves a string prompt untouched (no transcript to rewrite)', async () => {
    const loop = {
      stream: async (p: unknown) => ({ p }),
    } as unknown as ToolLoopAgent;
    const transform = vi.fn();
    const wrapped = withMessageTransforms(loop, [transform as MessageTransform]);
    await wrapped.stream({ prompt: 'just text' } as never);
    expect(transform).not.toHaveBeenCalled();
  });

  it('returns the loop untouched when there are no transforms', () => {
    const loop = {} as ToolLoopAgent;
    expect(withMessageTransforms(loop, [])).toBe(loop);
  });
});
