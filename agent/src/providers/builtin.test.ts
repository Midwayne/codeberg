import { describe, expect, it } from 'vitest';

import {
  llamacppProvider,
  openaiProvider,
  ProviderConfigError,
  registerBuiltinProviders,
} from './builtin.js';
import { defaultProviders } from './index.js';
import type { ModelProvider } from './registry.js';

describe('llamacppProvider', () => {
  it('registers by default without any API key', () => {
    // Local providers are always available; external ones need their key.
    expect(defaultProviders().list()).toContain('llamacpp');
  });

  it('resolves a free-form model id', () => {
    const m = llamacppProvider().model('ornith-1.0-35b');
    expect((m as { modelId: string }).modelId).toBe('ornith-1.0-35b');
  });
});

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
      expect(registered).toContain('ollama');
      expect(registered).toContain('llamacpp');
      expect(registered).not.toContain('openai');
      expect(registered).not.toContain('anthropic');
      expect(registered).not.toContain('google');
    });
  });

  it('rethrows unexpected registration errors', () => {
    withClearedProviderKeys(() => {
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
