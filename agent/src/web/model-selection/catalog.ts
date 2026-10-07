import { readFile } from 'node:fs/promises';

import { parseDocument } from 'yaml';

import {
  MODEL_INPUTS,
  type CatalogModel,
  type ModelInput,
  type ModelSelection,
} from '../../core/model-types.js';
import { maxReasoningProviderOptions } from '../../core/reasoning.js';
import type { ReasoningEffort } from '../../core/types.js';
import { profileFor } from '../../providers/profiles.js';
import { parsePricing } from '../usage/pricing.js';

export interface ModelCatalogOptions {
  catalogPath: string;
  defaultChat: ModelSelection;
  defaultLearning: ModelSelection;
  availableProvider?: (provider: string) => boolean;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const EFFORTS: readonly ReasoningEffort[] = [
  'provider-default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

function validEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && EFFORTS.includes(value as ReasoningEffort);
}

function fallbackCatalog(options: ModelCatalogOptions): CatalogModel[] {
  const defaults = new Set([options.defaultChat.key, options.defaultLearning.key]);
  const fallback = [...defaults].map((spec) => {
    const profile = profileFor(spec);
    if (
      (options.defaultChat.key === spec && options.defaultChat.effort === 'max') ||
      (options.defaultLearning.key === spec && options.defaultLearning.effort === 'max')
    ) {
      maxReasoningProviderOptions(profile.provider);
    }

    return {
      key: spec,
      model: spec,
      provider: profile.provider,
      label: profile.modelId,
      contextWindow: profile.contextWindow,
      efforts: [
        ...new Set<ReasoningEffort>([
          'provider-default',
          ...(options.defaultChat.key === spec ? [options.defaultChat.effort] : []),
          ...(options.defaultLearning.key === spec ? [options.defaultLearning.effort] : []),
        ]),
      ],
      inputs: ['text' as const],
    };
  });

  return fallback.filter(
    (model) => !options.availableProvider || options.availableProvider(model.provider),
  );
}

/** Read and validate the catalog independently of a user's saved selections. */
export async function loadModelCatalog(options: ModelCatalogOptions): Promise<CatalogModel[]> {
  let raw: string;
  try {
    raw = await readFile(options.catalogPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;

    return fallbackCatalog(options);
  }

  const document = parseDocument(raw, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`invalid models.yml: ${document.errors[0].message}`);

  const providers = object(object(document.toJS())?.providers);
  if (!providers) throw new Error('models.yml must contain providers with models');

  const models: CatalogModel[] = [];
  for (const [provider, definition] of Object.entries(providers)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(provider))
      throw new Error(`invalid provider in models.yml: ${provider}`);

    const entries = object(object(definition)?.models);
    if (!entries) throw new Error(`models.yml provider ${provider} must define models`);

    for (const [id, definition] of Object.entries(entries)) {
      const model = parseCatalogModel(provider, id, definition);
      if (!options.availableProvider || options.availableProvider(provider)) models.push(model);
    }
  }

  if (!models.length) throw new Error('models.yml must define at least one model');

  return models;
}

function parseCatalogModel(provider: string, id: string, definition: unknown): CatalogModel {
  const value = object(definition);
  if (!id.trim() || /\s/.test(id) || !value)
    throw new Error(`invalid model in models.yml: ${provider}:${id}`);

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

  const inputs = value.inputs ?? ['text'];
  if (
    !Array.isArray(inputs) ||
    inputs.length === 0 ||
    !inputs.includes('text') ||
    !inputs.every((input) => MODEL_INPUTS.includes(input as ModelInput))
  ) {
    throw new Error(`invalid inputs for ${provider}:${id}`);
  }

  const label = value.label;
  if (label !== undefined && (typeof label !== 'string' || !label.trim())) {
    throw new Error(`invalid label for ${provider}:${id}`);
  }

  return {
    pricing: parsePricing(value.pricing, `${provider}:${id}`),
    key: `${provider}:${id}`,
    model: `${provider}:${modelId}`,
    provider,
    label: typeof label === 'string' ? label : id,
    contextWindow: Number(window),
    efforts: [...new Set(efforts)],
    inputs: [...new Set(inputs)] as ModelInput[],
  };
}

export { object, validEffort };
