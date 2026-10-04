import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from './fs.js';
import { DEFAULT_LEARNING_SETTINGS, mergeLearningSettings, type LearningSettings } from './preferences.js';

export class LearningSettingsStore {
  private loaded?: Promise<LearningSettings>;
  private writing: Promise<void> = Promise.resolve();
  constructor(private readonly root: string) {}
  current(): Promise<LearningSettings> {
    this.loaded ??= readFile(join(this.root, 'settings.json'), 'utf8')
      .then((raw) => mergeLearningSettings(DEFAULT_LEARNING_SETTINGS, JSON.parse(raw)))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return mergeLearningSettings(DEFAULT_LEARNING_SETTINGS, {});
        this.loaded = undefined;
        throw error;
      });
    return this.loaded.then((settings) => structuredClone(settings));
  }
  update(patch: unknown): Promise<LearningSettings> {
    const update = this.writing.then(async () => {
      const next = mergeLearningSettings(await this.current(), patch);
      await writeJsonAtomic(join(this.root, 'settings.json'), next);
      this.loaded = Promise.resolve(next);
      return structuredClone(next);
    });
    this.writing = update.then(() => undefined, () => undefined);
    return update;
  }
}
