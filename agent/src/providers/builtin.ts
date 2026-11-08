import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

import { BUILTIN_PROVIDERS, type ProviderDescriptor } from './catalog.js';
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

function requireEnv(name: string, provider: string): string {
  const value = env(name);
  if (!value) {
    throw new ProviderConfigError(name, provider);
  }

  return value;
}

/**
 * Local servers speak OpenAI Chat Completions. `.chat()` forces that API —
 * neither implements OpenAI's Responses API, which `createOpenAI()` would
 * otherwise default to. The key is unused by the servers, but the client
 * requires a non-empty value.
 */
function modelFactory(descriptor: ProviderDescriptor): (modelId: string) => LanguageModel {
  const { name, local } = descriptor;
  const apiKey = () => requireEnv(descriptor.apiKeyEnv ?? '', name);

  switch (descriptor.client) {
    case 'openai':
      return createOpenAI({ apiKey: apiKey() });
    case 'anthropic':
      return createAnthropic({ apiKey: apiKey() });
    case 'google':
      return createGoogleGenerativeAI({ apiKey: apiKey() });
    case 'openai-compatible': {
      if (!local) throw new Error(`${name} has no local server endpoint`);

      const client = createOpenAI({
        baseURL: env(local.baseUrlEnv) ?? local.baseUrl,
        apiKey: env(local.apiKeyEnv) ?? local.apiKey,
      });

      return (id) => client.chat(id);
    }
    default: {
      const never: never = descriptor.client;

      return never;
    }
  }
}

/** A built-in provider. External ones throw ProviderConfigError without their key. */
export function builtinProvider(descriptor: ProviderDescriptor): ModelProvider {
  const model = modelFactory(descriptor);

  return { name: descriptor.name, model: (id) => model(id) };
}

/** Register every provider in the catalog whose credentials are present. */
export function registerBuiltinProviders(registry: { register(p: ModelProvider): unknown }): void {
  for (const descriptor of BUILTIN_PROVIDERS) {
    try {
      registry.register(builtinProvider(descriptor));
    } catch (err) {
      if (err instanceof ProviderConfigError) {
        continue;
      }

      throw err;
    }
  }
}
