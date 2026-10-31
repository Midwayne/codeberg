/** What each built-in provider needs before Codeberg can chat with it. */
export interface ProviderRequirement {
  label: string;
  env: readonly string[];
}

export const PROVIDER_REQUIREMENTS: Readonly<Record<string, ProviderRequirement>> = {
  openai: { label: 'OpenAI', env: ['OPENAI_API_KEY'] },
  anthropic: { label: 'Anthropic', env: ['ANTHROPIC_API_KEY'] },
  google: { label: 'Google', env: ['GOOGLE_GENERATIVE_AI_API_KEY'] },
  ollama: { label: 'Ollama', env: [] },
  llamacpp: { label: 'llama.cpp', env: [] },
};

/** Required variables for provider that are unset or empty in env. */
export function missingProviderEnv(provider: string, env: NodeJS.ProcessEnv): string[] {
  const requirement = PROVIDER_REQUIREMENTS[provider];
  if (!requirement) return [];

  return requirement.env.filter((name) => !env[name]);
}

export function providerLabel(provider: string): string {
  return PROVIDER_REQUIREMENTS[provider]?.label ?? provider;
}
