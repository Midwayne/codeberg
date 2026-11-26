import { registerBuiltinProviders } from './builtin.js';
import { ProviderRegistry } from './registry.js';

export {
  anthropicProvider,
  googleProvider,
  openaiProvider,
  registerBuiltinProviders,
} from './builtin.js';
export type { ModelProvider, ProviderRegistry } from './registry.js';

export function defaultProviders(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registerBuiltinProviders(registry);

  return registry;
}
