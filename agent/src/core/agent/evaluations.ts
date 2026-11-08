import type { LanguageModel } from 'ai';
import { modelSpecOf } from '../../providers/catalog.js';
import type { ModelProfile } from '../../providers/profiles.js';
import type { DaemonClient } from '../client.js';
import type { EvaluationConfiguration } from '../learning/evaluation/automatic-types.js';
import { createAutomaticEvaluationRuntime } from '../learning/evaluation/runtime.js';
import type { ReasoningEffort } from '../types.js';

export interface EvaluationModels {
  model: LanguageModel;
  /** Background model that judges answers; defaults to the chat model. */
  judge: LanguageModel;
  reasoning?: ReasoningEffort;
  profile: ModelProfile;
  judgeProfile: ModelProfile;
  daemon: DaemonClient;
}

/** The chat effort belongs to the chat model; a different judge runs at its provider default. */
export function evaluationConfiguration(models: EvaluationModels): EvaluationConfiguration {
  const chat = modelSpecOf(models.model);
  const judge = modelSpecOf(models.judge);
  const effort = models.reasoning ?? 'provider-default';

  return {
    candidate: { key: 'chat', model: chat, effort, contextWindow: models.profile.contextWindow },
    judge: {
      key: 'learning',
      model: judge,
      effort: judge === chat ? effort : 'provider-default',
      contextWindow: models.judgeProfile.contextWindow,
    },
  };
}

export function agentEvaluationRuntime(models: EvaluationModels) {
  return createAutomaticEvaluationRuntime({
    configuration: async () => evaluationConfiguration(models),
    resolveModel: (selection) => (selection.key === 'chat' ? models.model : models.judge),
    search: (query, search, signal) => models.daemon.search(query, search, signal),
  });
}
