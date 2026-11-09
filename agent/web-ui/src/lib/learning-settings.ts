import type { LearningSettings } from '@agent/core/learning/preferences';
import { jsonRequest, responseJson } from './response.js';

export async function loadLearningSettings(fetcher: typeof fetch = fetch): Promise<LearningSettings | null> {
  const response = await fetcher('/api/learning/settings');
  if (response.status === 404) return null;

  return responseJson<LearningSettings>(response);
}
export async function saveLearningSettings(
  settings: LearningSettings,
  fetcher: typeof fetch = fetch,
): Promise<LearningSettings> {
  const response = await fetcher('/api/learning/settings', jsonRequest('PUT', settings));

  return responseJson<LearningSettings>(response);
}
