import { providerDescriptor } from './catalog.js';

/** Required variables for provider that are unset or empty in env. */
export function missingProviderEnv(provider: string, env: NodeJS.ProcessEnv): string[] {
  const required = providerDescriptor(provider)?.apiKeyEnv;

  return required && !env[required] ? [required] : [];
}

export function providerLabel(provider: string): string {
  return providerDescriptor(provider)?.label ?? provider;
}
