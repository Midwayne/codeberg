import type { LearningSettings } from '@agent/core/learning/preferences';
export type { LearningSettings } from '@agent/core/learning/preferences';

export async function loadLearningSettings(fetcher: typeof fetch = fetch): Promise<LearningSettings | null> {
  const response = await fetcher('/api/learning/settings');
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<LearningSettings>;
}
export async function saveLearningSettings(
  settings: LearningSettings,
  fetcher: typeof fetch = fetch,
): Promise<LearningSettings> {
  const response = await fetcher('/api/learning/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<LearningSettings>;
}
