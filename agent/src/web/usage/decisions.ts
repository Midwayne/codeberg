import type { DecisionUsageSink } from '../../core/decisions/types.js';
import type { Project } from '../../core/projects.js';
import { captureUsage } from './model.js';
import type { UsageStore } from './store.js';

export function decisionUsageTracker(store: UsageStore, project?: Project): DecisionUsageSink {
  return (model, usage) => captureUsage(store, {
    model: `${model.provider}:${model.model}`, key: model.key, kind: 'decisions',
    project: project?.id, projectName: project?.name,
  }, {
    inputTokens: { total: usage?.input_tokens, noCache: undefined,
      cacheRead: usage?.input_tokens_details?.cached_tokens, cacheWrite: usage?.input_tokens_details?.cache_write_tokens },
    outputTokens: { total: usage?.output_tokens, text: undefined, reasoning: undefined },
  });
}
