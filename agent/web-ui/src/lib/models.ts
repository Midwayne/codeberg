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

/** The catalog and the default chat choice that chats without their own model follow. */
export type ChatModels = Pick<ModelSettings, 'models' | 'chat'>;

/** The catalog entry a chat runs on: its own listed choice, else the default. */
export function chatModelEntry(models: ChatModels | undefined, own: ModelSelection | null): CatalogModel | undefined {
  if (!models) return undefined;

  const listed = own && models.models.find((model) => model.key === own.key && model.efforts.includes(own.effort));

  return listed || models.models.find((model) => model.key === models.chat.key);
}

export async function loadModelSettings(): Promise<ModelSettings> {
  const response = await fetch('/api/models');
  return readJson<ModelSettings>(response);
}

export async function saveModelSettings(input: Pick<ModelSettings, 'chat' | 'learning' | 'summary' | 'judge' | 'subagents' | 'decisions'>): Promise<ModelSettings> {
  const response = await fetch('/api/models', jsonInit('PUT', input));
  return readJson<ModelSettings>(response);
}
