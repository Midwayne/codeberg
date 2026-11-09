import { LearningError } from '../errors.js';
import type { LearningSettings } from '../preferences.js';
import type { DreamingReport } from './types.js';

export const KNOWLEDGE_CONSOLIDATION_PAUSED = 'Knowledge consolidation is paused.';
export const REPORT_CATEGORY_PAUSED = 'A report category is paused.';

/** Refuse decide/apply when knowledge consolidation is off. */
export function assertKnowledgeActive(
  settings: Pick<LearningSettings, 'enabled' | 'knowledge'>,
): void {
  if (settings.enabled && settings.knowledge) return;

  throw new LearningError('conflict', KNOWLEDGE_CONSOLIDATION_PAUSED);
}

/** Refuse apply when any change's before-category is paused. */
export function assertReportCategoriesActive(
  report: DreamingReport | undefined,
  categories: LearningSettings['categories'],
): void {
  if (!report?.changes.some((change) => !categories[change.before.category])) return;

  throw new LearningError('conflict', REPORT_CATEGORY_PAUSED);
}
