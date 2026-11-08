import type { LanguageModel } from 'ai';

import { parseModelSpec } from './catalog.js';

/** Creates an ai-sdk LanguageModel for a provider-specific model id. */
export interface ModelProvider {
  readonly name: string;
  model(modelId: string): LanguageModel;
}

/** Registry of named providers; register custom ones alongside defaults. */
export class ProviderRegistry {
  private readonly providers = new Map<string, ModelProvider>();

  register(provider: ModelProvider): this {
    this.providers.set(provider.name, provider);

    return this;
  }

  get(name: string): ModelProvider | undefined {
    return this.providers.get(name);
  }

  /** Resolve "provider:modelId" (e.g. openai:gpt-4o-mini). */
  resolve(spec: string): LanguageModel {
    const { provider: name, modelId } = parseModelSpec(spec);
    if (!name) {
      throw new Error(`invalid model spec "${spec}", want provider:model`);
    }

    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`unknown provider "${name}"`);
    }

    return provider.model(modelId);
  }

  list(): string[] {
    return [...this.providers.keys()].sort();
  }
}
