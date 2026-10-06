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

export class LearningSettingsError extends Error {}

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

export function learningRecall(settings: LearningSettings) {
  return {
    history: settings.enabled && settings.history && settings.historyRecall,
    knowledge:
      settings.enabled &&
      settings.knowledge &&
      settings.knowledgeRecall &&
      Object.values(settings.categories).some(Boolean),
  };
}
