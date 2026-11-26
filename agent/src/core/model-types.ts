import type { ReasoningEffort } from './types.js';
import type { ModelPricing } from './usage.js';
import type { DecisionModel } from './decisions/types.js';
import type { ModelOverrides } from '../providers/overrides.js';

export const MODEL_INPUTS = ['text', 'vision', 'audio', 'video', 'pdf'] as const;

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
  /** Per-model settings from models.yml; `instructionsFile` is an absolute path. */
  overrides?: CatalogOverrides;
}

export type CatalogOverrides = Omit<ModelOverrides, 'instructions'> & { instructionsFile?: string };

/** Whether the agent may start subagents, and the model they run on. */
export interface SubagentSettings {
  enabled: boolean;
  /** Null runs subagents on the summary model (itself defaulting to the chat model). */
  model: ModelSelection | null;
}

/** Whether automatic evaluations are scored by a model judge, and which one. */
export interface JudgeSettings {
  /** Off, evaluations run only the scorers that need no model. */
  enabled: boolean;
  /** Null judges with the chat model, never a weaker learning model. */
  model: ModelSelection | null;
}

export interface ModelSelections {
  chat: ModelSelection;
  learning: ModelSelection;
  /** History summarizer. Null or absent summarizes on the chat model. */
  summary?: ModelSelection | null;
  /** Model judge for automatic evaluations. Absent keeps the saved choice. */
  judge?: JudgeSettings;
  subagents?: SubagentSettings;
  decisions?: string | null;
}

export interface ModelSettings extends ModelSelections {
  /** Always resolved by the server, falling back to CODEBERG_SUBAGENTS_USE. */
  subagents: SubagentSettings;
  /** Always resolved by the server: on, following the chat model, until changed. */
  judge: JudgeSettings;
  models: CatalogModel[];
  decisionModels?: DecisionModel[];
}
