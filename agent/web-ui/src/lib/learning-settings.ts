import type { LearningSettings } from '@agent/core/learning/preferences';
import { readJson, jsonInit } from './http';
export type { LearningSettings } from '@agent/core/learning/preferences';

export async function loadLearningSettings(fetcher: typeof fetch = fetch): Promise<LearningSettings | null> {
  const response = await fetcher('/api/learning/settings');
  if (response.status === 404) return null;
  return readJson<LearningSettings>(response);
}
export async function saveLearningSettings(
  settings: LearningSettings,
  fetcher: typeof fetch = fetch,
): Promise<LearningSettings> {
  const response = await fetcher('/api/learning/settings', jsonInit('PUT', settings));
  return readJson<LearningSettings>(response);
}
