import { isDailyDreaming } from './dreaming/scheduler.js';
import type { LearningSettings } from './preferences.js';
import type { KnowledgeJob } from './types.js';

/** The inputs both the service and the worker already have. */
export type JobGate = {
  type: KnowledgeJob['type'];
  sourceRefresh?: boolean;
  interactionId?: string;
  settings: LearningSettings;
  hasGenerator: boolean;
  evaluationsEnabled: boolean;
};

/** Whether a queued job may run. Learning off disables every type. */
export function jobTypeEnabled(gate: JobGate): boolean {
  if (!gate.settings.enabled) return false;

  switch (gate.type) {
    case 'evaluate_output':
      return gate.evaluationsEnabled;
    case 'extract_dataset':
      return datasetsReady(gate.settings);
    case 'consolidate_knowledge':
      return consolidateReady(gate);
    case 'extract_knowledge':
      return knowledgeReady(gate);
    default: {
      const never: never = gate.type;
      return never;
    }
  }
}

/** Datasets on and at least one kind selected. */
export function datasetsReady(settings: LearningSettings): boolean {
  return settings.datasets && Object.values(settings.kinds).some(Boolean);
}

/** Knowledge on and at least one category selected. */
export function knowledgeCategoriesReady(settings: LearningSettings): boolean {
  return settings.knowledge && Object.values(settings.categories).some(Boolean);
}

export function knowledgeBase(settings: LearningSettings, hasGenerator: boolean): boolean {
  return hasGenerator && knowledgeCategoriesReady(settings);
}

function consolidateReady(gate: JobGate): boolean {
  const daily = isDailyDreaming(gate.interactionId ?? '');
  if (daily && !gate.settings.dreaming) return false;

  return knowledgeBase(gate.settings, gate.hasGenerator);
}

function knowledgeReady(gate: JobGate): boolean {
  if (!knowledgeBase(gate.settings, gate.hasGenerator)) return false;

  return gate.sourceRefresh ? gate.settings.knowledgeRefresh : gate.settings.knowledgeCapture;
}
