import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseDocument } from 'yaml';

import { codebergHome } from '../core/paths.js';
import type { ReasoningEffort } from '../core/types.js';
import { writeJsonAtomic } from '../core/learning/fs.js';
import { profileFor } from '../providers/profiles.js';
import { maxReasoningProviderOptions } from '../core/reasoning.js';

const EFFORTS: readonly ReasoningEffort[] = [
  'provider-default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
];

export interface ModelSelection {
  /** Stable provider:key, independent of the provider's actual model name. */
  key: string;
  effort: ReasoningEffort;
}

export interface CatalogModel {
  key: string;
  /** Provider:model name sent to the model API. Several keys may share it. */
  model: string;
  provider: string;
  label: string;
  contextWindow: number;
  efforts: ReasoningEffort[];
}

export interface ModelSettings extends ModelSelections {
  models: CatalogModel[];
}

export interface ModelSelections {
  chat: ModelSelection;
  learning: ModelSelection;
}

export class ModelSelectionError extends Error {}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function validEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && EFFORTS.includes(value as ReasoningEffort);
}

export class ModelSettingsStore {
  private readonly catalogPath: string;
  private readonly settingsPath: string;
  private readonly defaultChat: ModelSelection;
  private readonly defaultLearning: ModelSelection;
  private readonly availableProvider?: (provider: string) => boolean;
  private writing: Promise<void> = Promise.resolve();

  constructor(options: {
    home?: string;
    catalogPath?: string;
    defaultChat: ModelSelection;
    defaultLearning: ModelSelection;
    availableProvider?: (provider: string) => boolean;
  }) {
    const home = options.home ?? codebergHome();
    this.catalogPath = options.catalogPath ?? join(home, 'models.yml');
    this.settingsPath = join(home, 'model-settings.json');
    this.defaultChat = options.defaultChat;
    this.defaultLearning = options.defaultLearning;
    this.availableProvider = options.availableProvider;
  }

  async current(): Promise<ModelSettings> {
    const models = await this.models();
    let stored: unknown;
    try {
      stored = JSON.parse(await readFile(this.settingsPath, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const values = object(stored);
    return {
      models,
      chat: this.resolve(values?.chat, this.defaultChat, models),
      learning: this.resolve(values?.learning, this.defaultLearning, models),
    };
  }

  async update(input: unknown): Promise<ModelSettings> {
    const values = object(input);
    if (!values) throw new ModelSelectionError('settings must have chat and learning selections');
    // Serialize validation and writes so two browser tabs cannot overwrite each other.
    const update = this.writing.then(async () => {
      const models = await this.models();
      const chat = this.validate(values.chat, models);
      const learning = this.validate(values.learning, models);
      await writeJsonAtomic(this.settingsPath, { chat, learning });
    });
    this.writing = update.catch(() => undefined);
    await update;
    return this.current();
  }

  private resolve(raw: unknown, fallback: ModelSelection, models: CatalogModel[]): ModelSelection {
    for (const candidate of [raw, fallback]) {
      const input = object(candidate);
      const effort = input?.effort;
      if (!validEffort(effort)) continue;
      // Old settings used `model` for the wire name; new settings use a stable key.
      const item = typeof input?.key === 'string'
        ? models.find((entry) => entry.key === input.key && entry.efforts.includes(effort))
        : models.find((entry) => entry.model === input?.model && entry.efforts.includes(effort))
          ?? models.find((entry) => entry.key === input?.model && entry.efforts.includes(effort));
      if (item) return { key: item.key, effort };
    }
    const first = models.find((model) => !this.availableProvider || this.availableProvider(model.provider));
    if (!first) throw new Error('models.yml contains no providers available with the current credentials');
    return { key: first.key, effort: first.efforts[0] };
  }

  private validate(raw: unknown, models: CatalogModel[]): ModelSelection {
    const input = object(raw);
    const item = models.find((entry) => entry.key === input?.key);
    if (!item || (this.availableProvider && !this.availableProvider(item.provider))) {
      throw new ModelSelectionError('unknown or unavailable model');
    }
    if (!validEffort(input?.effort) || !item.efforts.includes(input.effort)) {
      throw new ModelSelectionError(`unsupported effort for ${item.key}`);
    }
    return { key: item.key, effort: input.effort };
  }

  private async models(): Promise<CatalogModel[]> {
    let raw: string;
    try {
      raw = await readFile(this.catalogPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const defaults = new Set([this.defaultChat.key, this.defaultLearning.key]);
      const fallback = [...defaults].map((spec) => {
        const profile = profileFor(spec);
        if ((this.defaultChat.key === spec && this.defaultChat.effort === 'max') ||
            (this.defaultLearning.key === spec && this.defaultLearning.effort === 'max')) {
          maxReasoningProviderOptions(profile.provider);
        }
        return {
          key: spec,
          model: spec,
          provider: profile.provider,
          label: profile.modelId,
          contextWindow: profile.contextWindow,
          efforts: [...new Set<ReasoningEffort>([
            'provider-default',
            ...(this.defaultChat.key === spec ? [this.defaultChat.effort] : []),
            ...(this.defaultLearning.key === spec ? [this.defaultLearning.effort] : []),
          ])],
        };
      });
      return fallback.filter((model) => !this.availableProvider || this.availableProvider(model.provider));
    }
    const document = parseDocument(raw, { uniqueKeys: true });
    if (document.errors.length) throw new Error(`invalid models.yml: ${document.errors[0].message}`);
    const providers = object(object(document.toJS())?.providers);
    if (!providers) throw new Error('models.yml must contain providers with models');
    const models: CatalogModel[] = [];
    for (const [provider, definition] of Object.entries(providers)) {
      if (!/^[a-z][a-z0-9_-]*$/.test(provider)) throw new Error(`invalid provider in models.yml: ${provider}`);
      const entries = object(object(definition)?.models);
      if (!entries) throw new Error(`models.yml provider ${provider} must define models`);
      for (const [id, definition] of Object.entries(entries)) {
        const value = object(definition);
        if (!id.trim() || /\s/.test(id) || !value) throw new Error(`invalid model in models.yml: ${provider}:${id}`);
        const modelId = value.model ?? id;
        if (typeof modelId !== 'string' || !modelId.trim() || /\s/.test(modelId)) {
          throw new Error(`invalid model name for ${provider}:${id}`);
        }
        const window = value.context_window;
        if (!Number.isSafeInteger(window) || Number(window) < 1024) {
          throw new Error(`invalid context_window for ${provider}:${id}`);
        }
        const efforts = value.efforts;
        if (!Array.isArray(efforts) || efforts.length === 0 || !efforts.every(validEffort)) {
          throw new Error(`invalid efforts for ${provider}:${id}`);
        }
        if (efforts.includes('max')) maxReasoningProviderOptions(provider);
        const label = value.label;
        if (label !== undefined && (typeof label !== 'string' || !label.trim())) {
          throw new Error(`invalid label for ${provider}:${id}`);
        }
        if (!this.availableProvider || this.availableProvider(provider)) {
          models.push({
            key: `${provider}:${id}`, model: `${provider}:${modelId}`,
            provider, label: typeof label === 'string' ? label : id,
            contextWindow: Number(window), efforts: [...new Set(efforts)],
          });
        }
      }
    }
    if (!models.length) throw new Error('models.yml must define at least one model');
    return models;
  }
}
