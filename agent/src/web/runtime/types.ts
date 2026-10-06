import { parseEntryArgs } from '../../core/entry.js';
import { LearningService } from '../../core/learning/service.js';
import type { ProjectCatalog } from '../../core/projects.js';
import { defaultProviders } from '../../providers/index.js';
import { ExtensionStore } from '../extensions.js';
import { ReloadableAgentPool } from '../model-selection/runtime.js';
import { ModelSettingsStore } from '../model-selection/settings.js';
import { ResourceSettings } from '../resources.js';

export interface OwnedRuntime {
  learning?: LearningService;
  resources: ResourceSettings;
  pool: ReloadableAgentPool;
}

export interface ProjectRuntimeOptions {
  entry: NonNullable<ReturnType<typeof parseEntryArgs>>;
  catalog: ProjectCatalog;
  extensions: ExtensionStore;
  modelSettings: ModelSettingsStore;
  providers: ReturnType<typeof defaultProviders>;
  owned: OwnedRuntime[];
  title: string;
}
