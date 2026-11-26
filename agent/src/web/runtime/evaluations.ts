import type { LanguageModel } from 'ai';
import { DaemonClient } from '../../core/client.js';
import type { EvaluationModel } from '../../core/learning/evaluation/automatic-types.js';
import { createAutomaticEvaluationRuntime } from '../../core/learning/evaluation/runtime.js';
import type { ModelSelection, ModelSettings } from '../../core/model-types.js';
import type { ModelSettingsStore } from '../model-selection/settings.js';

export function projectEvaluationRuntime(
  daemonUrl: string,
  settings: ModelSettingsStore,
  resolve: (model: string) => LanguageModel,
  track: (model: LanguageModel, key: string, spec: string, kind: 'learning') => LanguageModel,
) {
  const daemon = new DaemonClient(daemonUrl);

  return createAutomaticEvaluationRuntime({
    configuration: async () => {
      const values = await settings.current();
      const candidate = selection(values.chat, values);
      if (!candidate) return undefined;
      if (!values.judge.enabled) return { candidate };

      // Unset, the chat model judges itself rather than a cheaper learning model judging it.
      const judge = selection(values.judge.model ?? values.chat, values);

      return judge ? { candidate, judge } : undefined;
    },
    resolveModel: (model) => track(resolve(model.model), model.key, model.model, 'learning'),
    search: (query, options, signal) => daemon.search(query, options, signal),
  });
}

function selection(value: ModelSelection, settings: ModelSettings): EvaluationModel | undefined {
  const model = settings.models.find((entry) => entry.key === value.key);

  return model
    ? {
        key: model.key,
        model: model.model,
        effort: value.effort,
        contextWindow: model.contextWindow,
      }
    : undefined;
}
