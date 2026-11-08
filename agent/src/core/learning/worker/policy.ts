import { isDailyDreaming } from '../dreaming/scheduler.js';
import type { KnowledgeJob } from '../types.js';
import type { KnowledgeWorkerState } from './state.js';

export function jobEnabled(state: KnowledgeWorkerState, job: KnowledgeJob): boolean {
  const settings = state.settings();
  if (!settings.enabled) return false;

  if (job.type === 'evaluate_output') return Boolean(state.evaluations?.enabled());

  if (
    job.type === 'consolidate_knowledge' &&
    isDailyDreaming(job.interaction_id) &&
    !settings.dreaming
  )
    return false;

  return job.type === 'extract_dataset'
    ? settings.datasets && Object.values(settings.kinds).some(Boolean)
    : Boolean(state.generator) &&
        settings.knowledge &&
        Object.values(settings.categories).some(Boolean) &&
        (job.type === 'consolidate_knowledge' ||
          (job.source_refresh ? settings.knowledgeRefresh : settings.knowledgeCapture));
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
