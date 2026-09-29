import type { CatalogModel, ModelSelection, ModelSettings } from '@agent/core/model-types.js';

export type { CatalogModel, ModelSelection, ModelSettings } from '@agent/core/model-types.js';

export function selectModel(
  current: ModelSelection,
  key: string,
  models: readonly CatalogModel[],
): ModelSelection {
  const option = models.find((entry) => entry.key === key);
  if (!option) return current;
  const effort = option.efforts.includes(current.effort) ? current.effort : option.efforts[0];
  return effort ? { key, effort } : current;
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
