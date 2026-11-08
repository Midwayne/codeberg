import { jobTypeEnabled } from '../job-enabled.js';
import type { KnowledgeJob } from '../types.js';
import type { KnowledgeWorkerState } from './state.js';

export function jobEnabled(state: KnowledgeWorkerState, job: KnowledgeJob): boolean {
  return jobTypeEnabled({
    type: job.type,
    sourceRefresh: job.source_refresh,
    interactionId: job.interaction_id,
    settings: state.settings(),
    hasGenerator: Boolean(state.generator),
    evaluationsEnabled: Boolean(state.evaluations?.enabled()),
  });
}

export function enabledType(
  state: KnowledgeWorkerState,
): 'extract_knowledge' | 'extract_dataset' | undefined | false {
  const settings = state.settings();
  if (!settings.enabled) return false;

  const knowledge =
    Boolean(state.generator) &&
    settings.knowledge &&
    Object.values(settings.categories).some(Boolean);

  const datasets = settings.datasets && Object.values(settings.kinds).some(Boolean);

  return knowledge || state.evaluations?.enabled()
    ? undefined
    : datasets
      ? 'extract_dataset'
      : false;
}
