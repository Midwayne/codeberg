import { join } from 'node:path';
import type { ReasoningEffort } from './types.js';
import type { ModelPricing } from './usage.js';
import type { DecisionModel } from './decisions/types.js';

export const MODEL_INPUTS = ['text', 'vision', 'audio', 'video', 'pdf'] as const;

export const MODELS_CATALOG_FILE = 'models.yml';

export const MODEL_SETTINGS_FILE = 'model-settings.json';

export function modelsCatalogPath(home: string): string {
  return join(home, MODELS_CATALOG_FILE);
}

export function modelSettingsPath(home: string): string {
  return join(home, MODEL_SETTINGS_FILE);
}

export type ModelInput = (typeof MODEL_INPUTS)[number];

export interface ModelSelection {
  /** Stable provider:key, independent of the provider's actual model name. */
  key: string;
  effort: ReasoningEffort;
}

export interface CatalogModel {
  pricing?: ModelPricing;
  key: string;
  /** Provider:model name sent to the model API. Several keys may share it. */
  model: string;
  provider: string;
  label: string;
  contextWindow: number;
  efforts: ReasoningEffort[];
  inputs: ModelInput[];
}

export interface ModelSelections {
  chat: ModelSelection;
  learning: ModelSelection;
  decisions?: string | null;
}

export interface ModelSettings extends ModelSelections {
  models: CatalogModel[];
  decisionModels?: DecisionModel[];
}
