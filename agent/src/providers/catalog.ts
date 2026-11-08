import type { LanguageModel } from 'ai';

export type CacheStrategy = 'anthropic' | 'openai' | 'none';

/** Client family for the chat model and for Browser Use's delegated model. */
export type ProviderClient = 'openai' | 'anthropic' | 'google' | 'openai-compatible';

/** A local OpenAI-compatible server: endpoint and placeholder key, both overridable. */
export interface LocalServer {
  baseUrlEnv: string;
  baseUrl: string;
  apiKeyEnv: string;
  apiKey: string;
}

/** Everything Codeberg knows about one built-in provider. */
export interface ProviderDescriptor {
  name: string;
  label: string;
  /** Required credential; the provider is skipped when it is unset. */
  apiKeyEnv?: string;
  local?: LocalServer;
  cache: CacheStrategy;
  /** Hosted APIs that reliably return several tool calls per response. */
  nativeParallelTools: boolean;
  /** OpenAI wire format, which needs `parallel_tool_calls` requested explicitly. */
  openaiWire: boolean;
  /** Responses API that accepts `reasoningEffort: 'max'`. */
  responses: boolean;
  client: ProviderClient;
  /** Conservative default context window for a model id. */
  window(modelId: string): number;
}

const ONE_MILLION = 1_000_000;

/** Local servers use whatever window was loaded; CODEBERG_CONTEXT_WINDOW widens it. */
const LOCAL_WINDOW = 8_192;

export const UNKNOWN_PROVIDER_WINDOW = 32_000;

function localProvider(name: string, label: string, local: LocalServer): ProviderDescriptor {
  return {
    name, label, local,
    // The OpenAI cache key is harmless to these servers; they reuse matching prefixes themselves.
    cache: 'openai',
    nativeParallelTools: false,
    openaiWire: true,
    responses: false,
    client: 'openai-compatible',
    window: () => LOCAL_WINDOW,
  };
}

export const BUILTIN_PROVIDERS: readonly ProviderDescriptor[] = [
  {
    name: 'openai', label: 'OpenAI', apiKeyEnv: 'OPENAI_API_KEY',
    cache: 'openai', nativeParallelTools: true, openaiWire: true, responses: true, client: 'openai',
    // gpt-4.1 / gpt-5 / o-series are 1M; the 4o family sits at ~128K.
    window: (id) => (/gpt-4\.1|gpt-5|(^|[^a-z])o\d/.test(id.toLowerCase()) ? ONE_MILLION : 128_000),
  },
  {
    name: 'anthropic', label: 'Anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY',
    cache: 'anthropic', nativeParallelTools: true, openaiWire: false, responses: false, client: 'anthropic',
    // Current Claude models are 1M except Haiku (200K).
    window: (id) => (id.toLowerCase().includes('haiku') ? 200_000 : ONE_MILLION),
  },
  {
    name: 'google', label: 'Google', apiKeyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY',
    cache: 'none', nativeParallelTools: true, openaiWire: false, responses: false, client: 'google',
    window: () => ONE_MILLION,
  },
  localProvider('ollama', 'Ollama', {
    baseUrlEnv: 'OLLAMA_BASE_URL', baseUrl: 'http://localhost:11434/v1', apiKeyEnv: 'OLLAMA_API_KEY', apiKey: 'ollama',
  }),
  // llama-server serves whichever model was loaded with `-m`, so the model id is a free-form label.
  localProvider('llamacpp', 'llama.cpp', {
    baseUrlEnv: 'LLAMACPP_BASE_URL', baseUrl: 'http://localhost:8080/v1', apiKeyEnv: 'LLAMACPP_API_KEY', apiKey: 'llama.cpp',
  }),
];

/** Responses gateways registered outside this package that also accept `max`. */
const EXTERNAL_RESPONSES_PROVIDERS = new Set(['thinktank']);

export function providerDescriptor(name: string): ProviderDescriptor | undefined {
  return BUILTIN_PROVIDERS.find((provider) => provider.name === name);
}

export function builtinProviderNames(): string[] {
  return BUILTIN_PROVIDERS.map((provider) => provider.name);
}

export function supportsMaxEffort(provider: string): boolean {
  return providerDescriptor(provider)?.responses === true || EXTERNAL_RESPONSES_PROVIDERS.has(provider);
}

/** Env names a provider reads: its credential and any local endpoint overrides. */
export function providerEnvNames(provider: string): string[] {
  const descriptor = providerDescriptor(provider);
  if (!descriptor) return [];

  const local = descriptor.local ? [descriptor.local.apiKeyEnv, descriptor.local.baseUrlEnv] : [];

  return [...(descriptor.apiKeyEnv ? [descriptor.apiKeyEnv] : []), ...local];
}

export interface ModelSpec {
  /** Empty when the spec has no `provider:` prefix. */
  provider: string;
  modelId: string;
}

/** Split `provider:model`; the model id may itself contain colons. */
export function parseModelSpec(spec: string): ModelSpec {
  const separator = spec.indexOf(':');

  return separator > 0
    ? { provider: spec.slice(0, separator), modelId: spec.slice(separator + 1) }
    : { provider: '', modelId: spec };
}

/** The `provider:model` spec of a resolved model. ai-sdk providers report
 *  `<provider>.<api>` (for example `openai.responses`); only the prefix names the provider. */
export function modelSpecOf(model: LanguageModel): string {
  if (typeof model === 'string') return model;

  return `${model.provider.split('.')[0]}:${model.modelId}`;
}
