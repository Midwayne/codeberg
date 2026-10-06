import type { ReasoningEffort } from './types.js';

export const MODEL_INPUTS = ['text', 'vision', 'audio', 'video', 'pdf'] as const;

export type ModelInput = (typeof MODEL_INPUTS)[number];

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
  inputs: ModelInput[];
}

export interface ModelSelections {
  chat: ModelSelection;
  learning: ModelSelection;
}

export interface ModelSettings extends ModelSelections {
  models: CatalogModel[];
}
