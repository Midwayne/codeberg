import type { LanguageModel } from 'ai';
import { DEFAULT_PROFILE } from '../../providers/profiles.js';
import { createAutomaticEvaluationRuntime } from '../learning/evaluation/runtime.js';
import type { AgentOptions } from './options.js';

export function agentEvaluationRuntime(options: AgentOptions) {
  const contextWindow = options.profile?.contextWindow ?? DEFAULT_PROFILE.contextWindow;
  const effort = options.reasoning ?? 'provider-default';
  const judge = options.subagentModel ?? options.model;

  return createAutomaticEvaluationRuntime({
    configuration: async () => ({
      candidate: { key: 'chat', model: modelId(options.model), effort, contextWindow },
      judge: { key: 'learning', model: modelId(judge), effort, contextWindow },
    }),
    resolveModel: (selection) => (selection.key === 'chat' ? options.model : judge),
    search: (query, search, signal) => options.daemon.search(query, search, signal),
  });
}

function modelId(model: LanguageModel): string {
  return typeof model === 'string' ? model : `${model.provider}:${model.modelId}`;
}
