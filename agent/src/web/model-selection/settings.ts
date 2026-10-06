import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { writeJsonAtomic } from '../../core/learning/fs.js';
import type { CatalogModel, ModelSelection, ModelSettings } from '../../core/model-types.js';
import { codebergHome } from '../../core/paths.js';
import { loadModelCatalog, object, validEffort, type ModelCatalogOptions } from './catalog.js';

export { MODEL_INPUTS } from '../../core/model-types.js';
export type {
  CatalogModel,
  ModelInput,
  ModelSelection,
  ModelSelections,
  ModelSettings,
} from '../../core/model-types.js';

export class ModelSelectionError extends Error {}

export class ModelSettingsStore {
  private readonly catalog: ModelCatalogOptions;
  private readonly settingsPath: string;
  private writing: Promise<void> = Promise.resolve();

  constructor(options: {
    home?: string;
    catalogPath?: string;
    defaultChat: ModelSelection;
    defaultLearning: ModelSelection;
    availableProvider?: (provider: string) => boolean;
  }) {
    const home = options.home ?? codebergHome();
    this.catalog = {
      catalogPath: options.catalogPath ?? join(home, 'models.yml'),
      defaultChat: options.defaultChat,
      defaultLearning: options.defaultLearning,
      availableProvider: options.availableProvider,
    };
    this.settingsPath = join(home, 'model-settings.json');
  }

  async current(): Promise<ModelSettings> {
    const models = await loadModelCatalog(this.catalog);
    let stored: unknown;
    try {
      stored = JSON.parse(await readFile(this.settingsPath, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const values = object(stored);

    return {
      models,
      chat: this.resolve(values?.chat, this.catalog.defaultChat, models),
      learning: this.resolve(values?.learning, this.catalog.defaultLearning, models),
    };
  }

  async update(input: unknown): Promise<ModelSettings> {
    const values = object(input);
    if (!values) throw new ModelSelectionError('settings must have chat and learning selections');

    // Serialize validation and writes so two browser tabs cannot overwrite each other.
    const update = this.writing.then(async () => {
      const models = await loadModelCatalog(this.catalog);
      const chat = this.validate(values.chat, models);
      const learning = this.validate(values.learning, models);
      await writeJsonAtomic(this.settingsPath, { chat, learning });
    });

    this.writing = update.catch(() => undefined);
    await update;

    return this.current();
  }

  private resolve(raw: unknown, fallback: ModelSelection, models: CatalogModel[]): ModelSelection {
    for (const candidate of [raw, fallback]) {
      const input = object(candidate);
      const effort = input?.effort;
      if (!validEffort(effort)) continue;

      // Old settings used `model` for the wire name; new settings use a stable key.
      const item =
        typeof input?.key === 'string'
          ? models.find((entry) => entry.key === input.key && entry.efforts.includes(effort))
          : (models.find(
              (entry) => entry.model === input?.model && entry.efforts.includes(effort),
            ) ??
            models.find((entry) => entry.key === input?.model && entry.efforts.includes(effort)));

      if (item) return { key: item.key, effort };
    }

    const first = models.find(
      (model) => !this.catalog.availableProvider || this.catalog.availableProvider(model.provider),
    );
    if (!first)
      throw new Error('models.yml contains no providers available with the current credentials');

    return { key: first.key, effort: first.efforts[0] };
  }

  private validate(raw: unknown, models: CatalogModel[]): ModelSelection {
    const input = object(raw);
    const item = models.find((entry) => entry.key === input?.key);
    if (
      !item ||
      (this.catalog.availableProvider && !this.catalog.availableProvider(item.provider))
    ) {
      throw new ModelSelectionError('unknown or unavailable model');
    }

    if (!validEffort(input?.effort) || !item.efforts.includes(input.effort)) {
      throw new ModelSelectionError(`unsupported effort for ${item.key}`);
    }

    return { key: item.key, effort: input.effort };
  }
}
