import type { ReasoningEffort } from '@agent/core/types.js';

export interface ModelSelection {
  key: string;
  effort: ReasoningEffort;
}

export interface CatalogModel {
  key: string;
  /** Provider:model sent to the model API; can be shared by multiple keys. */
  model: string;
  provider: string;
  label: string;
  contextWindow: number;
  efforts: ReasoningEffort[];
}

export interface ModelSettings {
  chat: ModelSelection;
  learning: ModelSelection;
  models: CatalogModel[];
}

export function selectModel(
  current: ModelSelection,
  key: string,
  models: readonly CatalogModel[],
): ModelSelection {
  const option = models.find((entry) => entry.key === key);
  if (!option) return current;
  return { key, effort: option.efforts.includes(current.effort) ? current.effort : option.efforts[0] };
}

export async function loadModelSettings(): Promise<ModelSettings> {
  const response = await fetch('/api/models');
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<ModelSettings>;
}

export async function saveModelSettings(input: Pick<ModelSettings, 'chat' | 'learning'>): Promise<ModelSettings> {
  const response = await fetch('/api/models', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<ModelSettings>;
}
