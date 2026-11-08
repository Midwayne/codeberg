import type { CatalogModel, ModelSettings } from '../core/model-types.js';
import type { ReasoningEffort } from '../core/types.js';

/** Browser title shared by the SPA metadata endpoint and fallback page. */
export function formatWebTitle(modelSpec: string, reasoning?: ReasoningEffort): string {
  const modelName = modelSpec.slice(modelSpec.indexOf(':') + 1);

  return `${modelName} · reasoning: ${reasoning ?? 'provider-default'}`;
}

export function selectedChatModel(settings: ModelSettings): CatalogModel | undefined {
  return settings.models.find((entry) => entry.key === settings.chat.key);
}

/** Title for the selected chat model; a key that differs from its model name is shown too. */
export function chatModelTitle(settings: ModelSettings): string | undefined {
  const selected = selectedChatModel(settings);
  if (!selected) return undefined;

  const title = formatWebTitle(selected.model, settings.chat.effort);
  if (selected.key === selected.model) return title;

  return `${title} · ${selected.key.slice(selected.provider.length + 1)}`;
}
