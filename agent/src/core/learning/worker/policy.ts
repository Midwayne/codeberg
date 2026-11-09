import {
  datasetsReady,
  jobTypeEnabled,
  knowledgeBase,
} from '../job-enabled.js';
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

  const knowledge = knowledgeBase(settings, Boolean(state.generator));
  const datasets = datasetsReady(settings);

  return knowledge || state.evaluations?.enabled()
    ? undefined
    : datasets
      ? 'extract_dataset'
      : false;
}
