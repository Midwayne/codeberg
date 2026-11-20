import type { CatalogModel, ModelSelection, ModelSettings } from '@agent/core/model-types.js';
import { readJson, jsonInit } from './http';

export type { CatalogModel, ModelSelection, ModelSettings } from '@agent/core/model-types.js';

export function selectModel(current: ModelSelection, key: string, models: readonly CatalogModel[]): ModelSelection {
  const option = models.find((entry) => entry.key === key);
  if (!option) return current;
  const effort = option.efforts.includes(current.effort) ? current.effort : option.efforts[0];
  return effort ? { key, effort } : current;
}

/** `provider · Label`, plus the catalog key's suffix when it differs from the wire name. */
export function modelOptionLabel(model: CatalogModel): string {
  const suffix = model.key !== model.model ? ` (${model.key.slice(model.provider.length + 1)})` : '';

  return `${model.provider} · ${model.label}${suffix}`;
}

export async function loadModelSettings(): Promise<ModelSettings> {
  const response = await fetch('/api/models');
  return readJson<ModelSettings>(response);
}

export async function saveModelSettings(input: Pick<ModelSettings, 'chat' | 'learning' | 'summary' | 'subagents' | 'decisions'>): Promise<ModelSettings> {
  const response = await fetch('/api/models', jsonInit('PUT', input));
  return readJson<ModelSettings>(response);
}
