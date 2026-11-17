import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ifMissing, writeJsonAtomic } from '../../core/fs.js';
import type { CatalogModel, ModelSelection, ModelSettings } from '../../core/model-types.js';
import { codebergHome } from '../../core/paths.js';
import { loadModelCatalog, object, validEffort, type ModelCatalogOptions } from './catalog.js';
import { loadDecisionCatalog, resolveDecision } from '../../core/decisions/catalog.js';

export type {
  CatalogModel,
  ModelInput,
  ModelSelection,
  ModelSelections,
  ModelSettings,
} from '../../core/model-types.js';
import { HttpError } from '../../core/http-error.js';
import { readModelsFile } from '../../core/models-file.js';

export class ModelSelectionError extends HttpError {
  constructor(message: string) {
    super(400, message);
  }
}

export class ModelSettingsStore {
  private readonly catalog: ModelCatalogOptions;
  private readonly settingsPath: string;
  private writing: Promise<void> = Promise.resolve();
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: {
    home?: string;
    env?: NodeJS.ProcessEnv;
    catalogPath?: string;
    defaultChat: ModelSelection;
    defaultLearning: ModelSelection;
    availableProvider?: (provider: string) => boolean;
  }) {
    const home = options.home ?? codebergHome(options.env);
    this.env = options.env ?? process.env;
    this.catalog = {
      catalogPath: options.catalogPath ?? join(home, 'models.yml'),
      defaultChat: options.defaultChat,
      defaultLearning: options.defaultLearning,
      availableProvider: options.availableProvider,
    };
    this.settingsPath = join(home, 'model-settings.json');
  }

  async current(): Promise<ModelSettings> {
    // Both catalogs come from one models.yml parse, read alongside the saved choices.
    const [file, stored] = await Promise.all([readModelsFile(this.catalog.catalogPath), this.stored()]);
    const models = await loadModelCatalog(this.catalog, file);
    const catalog = await loadDecisionCatalog(this.catalog.catalogPath, this.env, file);
    const values = object(stored);

    return {
      models,
      decisionModels: catalog.decisionModels,
      decisions: resolveDecision(catalog, values?.decisions),
      chat: this.resolve(values?.chat, this.catalog.defaultChat, models),
      learning: this.resolve(values?.learning, this.catalog.defaultLearning, models),
      summary: this.resolveSummary(values?.summary, models),
    };
  }

  private async stored(): Promise<unknown> {
    const text = await readFile(this.settingsPath, 'utf8').catch(ifMissing(undefined));

    return text === undefined ? undefined : JSON.parse(text);
  }

  /** Providers the catalog names, whether or not their credentials are set. */
  async catalogProviders(): Promise<string[]> {
    const models = await loadModelCatalog({ ...this.catalog, availableProvider: undefined });

    return [...new Set(models.map((model) => model.provider))].filter(Boolean);
  }

  async update(input: unknown): Promise<ModelSettings> {
    const values = object(input);
    if (!values) throw new ModelSelectionError('settings must have chat and learning selections');

    // Serialize validation and writes so two browser tabs cannot overwrite each other.
    const update = this.writing.then(async () => {
      const models = await loadModelCatalog(this.catalog);
      const chat = this.validate(values.chat, models);
      const learning = this.validate(values.learning, models);
      const current = await this.current();
      const summary = this.validateSummary(values.summary, current.summary ?? null, models);
      const decisions = values.decisions === undefined ? current.decisions : values.decisions;
      if (decisions !== null && !current.decisionModels?.some((model) => model.key === decisions)) {
        throw new ModelSelectionError('unknown or unavailable decision model');
      }

      await writeJsonAtomic(this.settingsPath, { chat, learning, summary, decisions });
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

  /** Null means summaries follow the chat model, including when a saved choice is gone. */
  private resolveSummary(raw: unknown, models: CatalogModel[]): ModelSelection | null {
    const input = object(raw);
    const effort = input?.effort;
    const item = models.find((entry) => entry.key === input?.key);
    if (!item || !validEffort(effort) || !item.efforts.includes(effort)) return null;

    return { key: item.key, effort };
  }

  /** Omitted keeps the saved choice; null returns summaries to the chat model. */
  private validateSummary(
    raw: unknown,
    saved: ModelSelection | null,
    models: CatalogModel[],
  ): ModelSelection | null {
    if (raw === undefined) return saved;

    return raw === null ? null : this.validate(raw, models);
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
