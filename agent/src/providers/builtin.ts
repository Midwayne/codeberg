import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';

import type { ModelProvider } from './registry.js';

function env(name: string): string | undefined {
  const v = process.env[name];

  return v && v.length > 0 ? v : undefined;
}

/** Thrown when a provider factory needs an env var that is unset. */
export class ProviderConfigError extends Error {
  constructor(
    readonly envName: string,
    readonly provider: string,
  ) {
    super(`${envName} is required for the ${provider} provider`);
    this.name = 'ProviderConfigError';
  }
}

/** Read a required API key. Missing keys throw ProviderConfigError so
 *  registerBuiltinProviders can skip the provider without crashing startup. */
function requireEnv(name: string, provider: string): string {
  const value = env(name);
  if (!value) {
    throw new ProviderConfigError(name, provider);
  }

  return value;
}

export function openaiProvider(): ModelProvider {
  const openai = createOpenAI({
    apiKey: requireEnv('OPENAI_API_KEY', 'openai'),
  });

  return { name: 'openai', model: (id) => openai(id) };
}

export function anthropicProvider(): ModelProvider {
  const anthropic = createAnthropic({
    apiKey: requireEnv('ANTHROPIC_API_KEY', 'anthropic'),
  });

  return { name: 'anthropic', model: (id) => anthropic(id) };
}

export function googleProvider(): ModelProvider {
  const google = createGoogleGenerativeAI({
    apiKey: requireEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'google'),
  });

  return { name: 'google', model: (id) => google(id) };
}

/**
 * Every built-in provider factory. Each throws without its API key and is
 * skipped.
 * Add a provider by writing its factory and appending it here — registration is
 * the single loop below.
 */
const BUILTIN: ReadonlyArray<() => ModelProvider> = [
  openaiProvider,
  anthropicProvider,
  googleProvider,
];

export function registerBuiltinProviders(registry: { register(p: ModelProvider): unknown }): void {
  for (const make of BUILTIN) {
    try {
      registry.register(make());
    } catch (err) {
      if (err instanceof ProviderConfigError) {
        continue;
      }

      throw err;
    }
  }
}
