import { writeModuleLog } from '../../module-log.js';
import { jobTypeEnabled } from '../job-enabled.js';
import type { LearningSettings } from '../preferences.js';
import { syncWatcher, wakeWorker } from './background.js';
import { scheduleDreaming } from './dreaming-schedule.js';
import { refreshEvaluations } from './evaluations.js';
import type { KnowledgeJob } from '../types.js';
import { reconcileJobs } from './reconciliation.js';
import { refreshKnowledge } from './refresh.js';
import type { LearningServiceState } from './state.js';

export async function getSettings(state: LearningServiceState): Promise<LearningSettings> {
  state.preferences = await state.settingsStore.current();

  return state.settings;
}

export async function updateSettings(
  state: LearningServiceState,
  patch: unknown,
): Promise<LearningSettings> {
  state.preferences = await state.settingsStore.update(patch);
  state.settingsRevision++;
  if (state.initialized) {
    try {
      if (state.knowledgeEnabled && state.preferences.knowledgeRefresh) {
        state.sourceWatcher.resume();
        await refreshKnowledge(state);
        await syncWatcher(state);
      } else state.sourceWatcher.stop();

      await reconcileJobs(state);
      await scheduleDreaming(state);
      await refreshEvaluations(state);
    } catch (error) {
      writeModuleLog('learning-agent', 'settings_reconcile_failed', { error: String(error) });
    } finally {
      wakeWorker(state);
    }
  }

  return state.settings;
}

export function jobEnabled(
  state: LearningServiceState,
  job: {
    type: KnowledgeJob['type'];
    source_refresh?: boolean;
    interaction_id?: string;
  },
): boolean {
  return jobTypeEnabled({
    type: job.type,
    sourceRefresh: job.source_refresh,
    interactionId: job.interaction_id,
    settings: state.preferences,
    hasGenerator: state.hasGenerator,
    evaluationsEnabled: Boolean(state.evaluations?.enabled()),
  });
}
