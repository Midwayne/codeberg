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
 * ollama and llamacpp both serve an OpenAI-compatible Chat Completions API and
 * differ only in default endpoint and key. `.chat()` forces Chat Completions —
 * neither implements OpenAI's Responses API, which `createOpenAI()` would
 * otherwise default to. The key is unused by the servers, but the client
 * requires a non-empty value.
 */
function openAICompatible(opts: {
  name: string;
  baseURLEnv: string;
  baseURLDefault: string;
  keyEnv: string;
  keyDefault: string;
}): ModelProvider {
  const client = createOpenAI({
    baseURL: env(opts.baseURLEnv) ?? opts.baseURLDefault,
    apiKey: env(opts.keyEnv) ?? opts.keyDefault,
  });
  return { name: opts.name, model: (id) => client.chat(id) };
}

export function ollamaProvider(): ModelProvider {
  return openAICompatible({
    name: 'ollama',
    baseURLEnv: 'OLLAMA_BASE_URL',
    baseURLDefault: 'http://localhost:11434/v1',
    keyEnv: 'OLLAMA_API_KEY',
    keyDefault: 'ollama',
  });
}

export function llamacppProvider(): ModelProvider {
  // llama-server serves whichever model was loaded with `-m`, so the model id is
  // a free-form label.
  return openAICompatible({
    name: 'llamacpp',
    baseURLEnv: 'LLAMACPP_BASE_URL',
    baseURLDefault: 'http://localhost:8080/v1',
    keyEnv: 'LLAMACPP_API_KEY',
    keyDefault: 'llama.cpp',
  });
}

/**
 * Every built-in provider factory. The external ones (openai/anthropic/google)
 * throw without their API key and are skipped; the local ones always register.
 * Add a provider by writing its factory and appending it here — registration is
 * the single loop below.
 */
const BUILTIN: ReadonlyArray<() => ModelProvider> = [
  openaiProvider,
  anthropicProvider,
  googleProvider,
  ollamaProvider,
  llamacppProvider,
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
