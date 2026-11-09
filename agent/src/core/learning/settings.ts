import { join } from 'node:path';
import { readOptionalText, writeJsonAtomic } from './fs.js';
import { WriteLock } from '../write-lock.js';
import {
  DEFAULT_LEARNING_SETTINGS,
  mergeLearningSettings,
  type LearningSettings,
} from './preferences.js';

export class LearningSettingsStore {
  private loaded?: Promise<LearningSettings>;
  private readonly lock = new WriteLock();

  constructor(private readonly root: string) {}

  current(): Promise<LearningSettings> {
    this.loaded ??= readOptionalText(join(this.root, 'settings.json'))
      .then((raw) =>
        mergeLearningSettings(DEFAULT_LEARNING_SETTINGS, raw === undefined ? {} : JSON.parse(raw)),
      )
      .catch((error: unknown) => {
        this.loaded = undefined;
        throw error;
      });

    return this.loaded.then((settings) => structuredClone(settings));
  }

  update(patch: unknown): Promise<LearningSettings> {
    return this.lock.run(async () => {
      const next = mergeLearningSettings(await this.current(), patch);
      await writeJsonAtomic(join(this.root, 'settings.json'), next);
      this.loaded = Promise.resolve(next);

      return structuredClone(next);
    });
  }
}
