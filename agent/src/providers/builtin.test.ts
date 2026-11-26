import { describe, expect, it } from 'vitest';

import {
  openaiProvider,
  ProviderConfigError,
  registerBuiltinProviders,
} from './builtin.js';
import type { ModelProvider } from './registry.js';

describe('registerBuiltinProviders', () => {
  function withClearedProviderKeys(fn: () => void): void {
    const keys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'] as const;
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) {
      delete process.env[k];
    }

    try {
      fn();
    } finally {
      for (const k of keys) {
        if (prev[k] !== undefined) {
          process.env[k] = prev[k];
        } else {
          delete process.env[k];
        }
      }
    }
  }

  it('skips providers that throw ProviderConfigError', () => {
    withClearedProviderKeys(() => {
      const registered: string[] = [];
      registerBuiltinProviders({
        register(p) {
          registered.push(p.name);
        },
      });
      expect(registered).toEqual([]);
      expect(registered).not.toContain('openai');
      expect(registered).not.toContain('anthropic');
      expect(registered).not.toContain('google');
    });
  });

  it('rethrows unexpected registration errors', () => {
    withClearedProviderKeys(() => {
      process.env.OPENAI_API_KEY = 'sk-test';
      expect(() =>
        registerBuiltinProviders({
          register() {
            throw new Error('boom');
          },
        }),
      ).toThrow('boom');
    });
  });

  it('openaiProvider throws ProviderConfigError without a key', () => {
    withClearedProviderKeys(() => {
      expect(() => openaiProvider()).toThrow(ProviderConfigError);
    });
  });

  it('registers openai when the key is present', () => {
    withClearedProviderKeys(() => {
      process.env.OPENAI_API_KEY = 'sk-test';
      const registered: ModelProvider[] = [];
      registerBuiltinProviders({
        register(p) {
          registered.push(p);
        },
      });
      expect(registered.map((p) => p.name)).toContain('openai');
    });
  });
});
