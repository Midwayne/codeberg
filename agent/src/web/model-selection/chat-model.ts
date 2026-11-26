import type { CatalogModel, ModelSelection } from '../../core/model-types.js';
import { record as object } from '../../core/record.js';
import { validEffort } from './catalog.js';

const MAX_MODEL_KEY_LENGTH = 200;

/**
 * A chat-specific model as stored on a saved chat: a selection, `null` to
 * follow the default again, or `undefined` when the value is malformed.
 */
export function readChatModel(value: unknown): ModelSelection | null | undefined {
  if (value === null) return null;

  const input = object(value);
  const key = input?.key;
  const effort = input?.effort;
  if (typeof key !== 'string' || !key || key.length > MAX_MODEL_KEY_LENGTH) return undefined;
  if (!validEffort(effort)) return undefined;

  return { key, effort };
}

/**
 * The selection one chat request runs on. A chat's own choice wins while the
 * catalog still offers it with that effort; otherwise the chat follows the
 * default from Models, so a removed model never blocks a saved chat.
 */
export function chatModelChoice(
  requested: unknown,
  fallback: ModelSelection,
  models: readonly CatalogModel[],
): ModelSelection {
  const chosen = readChatModel(requested);
  if (!chosen) return fallback;

  const entry = models.find((model) => model.key === chosen.key);

  return entry?.efforts.includes(chosen.effort) ? chosen : fallback;
}
