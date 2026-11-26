import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ifMissing, writeJsonAtomic } from '../../core/fs.js';
import type { CatalogModel, JudgeSettings, ModelSelection, ModelSettings, SubagentSettings } from '../../core/model-types.js';
import { subagentsEnabled } from '../../core/subagents/config.js';
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

type SwitchedRole = SubagentSettings & JudgeSettings;

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
      summary: this.resolveOptional(values?.summary, models),
      judge: this.resolveSwitched(values?.judge, models, true),
      subagents: this.resolveSwitched(values?.subagents, models, subagentsEnabled(this.env)),
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
      const summary = this.validateOptional(values.summary, current.summary ?? null, models);
      const judge = values.judge === undefined ? current.judge : this.validateSwitched(values.judge, models, 'judge');
      const subagents = values.subagents === undefined ? current.subagents : this.validateSwitched(values.subagents, models, 'subagents');
      const decisions = values.decisions === undefined ? current.decisions : values.decisions;
      if (decisions !== null && !current.decisionModels?.some((model) => model.key === decisions)) {
        throw new ModelSelectionError('unknown or unavailable decision model');
      }

      await writeJsonAtomic(this.settingsPath, { chat, learning, summary, judge, subagents, decisions });
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

  /** An optional model choice (summaries, judge, subagents); null follows another model, including when a saved choice is gone. */
  private resolveOptional(raw: unknown, models: CatalogModel[]): ModelSelection | null {
    const input = object(raw);
    const effort = input?.effort;
    const item = models.find((entry) => entry.key === input?.key);
    if (!item || !validEffort(effort) || !item.efforts.includes(effort)) return null;

    return { key: item.key, effort };
  }

  /**
   * A role with an on/off switch and an optional model (subagents, judge).
   * Unsaved, it starts at `enabled`; a removed model falls back to the role's default.
   */
  private resolveSwitched(raw: unknown, models: CatalogModel[], enabled: boolean): SwitchedRole {
    const input = object(raw);

    return {
      enabled: typeof input?.enabled === 'boolean' ? input.enabled : enabled,
      model: this.resolveOptional(input?.model, models),
    };
  }

  private validateSwitched(raw: unknown, models: CatalogModel[], role: string): SwitchedRole {
    const input = object(raw);
    if (typeof input?.enabled !== 'boolean') throw new ModelSelectionError(`${role} needs an enabled switch`);

    const model = input.model == null ? null : this.validate(input.model, models);

    return { enabled: input.enabled, model };
  }

  /** Omitted keeps the saved choice; null returns summaries to the chat model. */
  private validateOptional(
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
