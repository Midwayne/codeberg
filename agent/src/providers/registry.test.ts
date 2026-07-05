import { describe, expect, it } from 'vitest';

import { ProviderRegistry, type ModelProvider } from './registry.js';

describe('ProviderRegistry', () => {
  it('resolves provider:model', () => {
    const reg = new ProviderRegistry();
    const stub: ModelProvider = {
      name: 'test',
      model: (id) => ({ modelId: id }) as never,
    };
    reg.register(stub);
    const m = reg.resolve('test:foo');
    expect((m as { modelId: string }).modelId).toBe('foo');
  });

  it('rejects unknown provider', () => {
    const reg = new ProviderRegistry();
    expect(() => reg.resolve('nope:x')).toThrow(/unknown provider/);
  });
});
