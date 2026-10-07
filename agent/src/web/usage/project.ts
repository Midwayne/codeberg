import type { LanguageModel } from 'ai';
import type { Project } from '../../core/projects.js';
import type { ModelSettingsStore } from '../model-selection/settings.js';
import { trackModelUsage } from './model.js';
import type { UsageStore } from './store.js';

export function projectUsageTracker(store: UsageStore, settings: ModelSettingsStore, project: Project) {
  return (model: LanguageModel, key: string, spec: string, kind: 'chat' | 'learning') => trackModelUsage(
    model, store, { key, model: spec, kind, project: project.id, projectName: project.name },
    async () => (await settings.current()).models.find((entry) => entry.key === key)?.pricing,
  );
}
