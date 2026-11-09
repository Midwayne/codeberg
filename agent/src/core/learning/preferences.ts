import { LearningError } from './errors.js';

/** Shared wire format; defaults retain the existing learning behavior. */
export const KNOWLEDGE_CATEGORIES = ['services', 'flows', 'concepts', 'debugging'] as const;
export const DATASET_KINDS = [
  'retrieval',
  'sft',
  'preferences',
  'rlvr',
  'hard_negatives',
  'hard_negative_candidates',
] as const;

export interface LearningSettings {
  enabled: boolean;
  history: boolean;
  historyCapture: boolean;
  historyRecall: boolean;
  knowledge: boolean;
  knowledgeCapture: boolean;
  knowledgeRecall: boolean;
  knowledgeRefresh: boolean;
  /** Generate daily consolidation proposals without automatically applying them. */
  dreaming: boolean;
  datasets: boolean;
  training: boolean;
  evals: boolean;
  categories: Record<(typeof KNOWLEDGE_CATEGORIES)[number], boolean>;
  kinds: Record<(typeof DATASET_KINDS)[number], boolean>;
}
export const DEFAULT_LEARNING_SETTINGS: LearningSettings = {
  enabled: true,
  history: true,
  historyCapture: true,
  historyRecall: true,
  knowledge: true,
  knowledgeCapture: true,
  knowledgeRecall: true,
  knowledgeRefresh: true,
  dreaming: false,
  datasets: true,
  training: true,
  evals: true,
  categories: { services: true, flows: true, concepts: true, debugging: true },
  kinds: {
    retrieval: true,
    sft: true,
    preferences: true,
    rlvr: true,
    hard_negatives: true,
    hard_negative_candidates: true,
  },
};

export class LearningSettingsError extends LearningError {
  constructor(message: string) {
    super('invalid', message);
    this.name = 'LearningSettingsError';
  }
}

/** Accept a partial patch, rejecting typos and non-boolean values before writing. */
export function mergeLearningSettings(current: LearningSettings, patch: unknown): LearningSettings {
  function merge(base: Record<string, unknown>, input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new LearningSettingsError('settings must be an object');

    const result = { ...base };
    for (const [key, value] of Object.entries(input)) {
      if (!Object.hasOwn(base, key))
        throw new LearningSettingsError(`unknown learning setting: ${key}`);

      if (typeof base[key] === 'object')
        result[key] = merge(base[key] as Record<string, unknown>, value);
      else {
        if (typeof value !== 'boolean') throw new LearningSettingsError(`${key} must be a boolean`);

        result[key] = value;
      }
    }

    return result;
  }

  return merge(current as unknown as Record<string, unknown>, patch) as unknown as LearningSettings;
}

export function historyCaptureEnabled(settings: LearningSettings): boolean {
  return settings.enabled && settings.history && settings.historyCapture;
}

/** Knowledge on and at least one category selected. */
export function knowledgeCategoriesReady(settings: LearningSettings): boolean {
  return settings.knowledge && Object.values(settings.categories).some(Boolean);
}

/** Datasets on and at least one kind selected. */
export function datasetsReady(settings: LearningSettings): boolean {
  return settings.datasets && Object.values(settings.kinds).some(Boolean);
}

/** User-facing text when history capture is off (HTTP 409 / LearningError conflict). */
export const HISTORY_CAPTURE_PAUSED = 'Learning history is paused. Enable it in Settings.';

/** User-facing text when training/eval/dismiss review writes are paused. */
export const REVIEW_COMPONENT_PAUSED =
  'This review component is paused. Enable it in Settings → Learning.';

/** True when a review decision may write to datasets. */
export function reviewWritesEnabled(
  settings: LearningSettings,
  decision: 'training' | 'eval' | 'dismiss',
): boolean {
  if (!settings.enabled || !settings.datasets) return false;

  if (decision === 'training') return settings.training;

  if (decision === 'eval') return settings.evals;

  return true;
}

export function learningRecall(settings: LearningSettings) {
  return {
    history: settings.enabled && settings.history && settings.historyRecall,
    knowledge: settings.enabled && settings.knowledgeRecall && knowledgeCategoriesReady(settings),
  };
}
