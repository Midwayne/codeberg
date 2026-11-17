import type { ReasoningEffort } from '../core/types.js';
import { parseModelSpec } from '../providers/spec.js';

/** Browser title shared by the SPA metadata endpoint and fallback page. */
export function formatWebTitle(modelSpec: string, reasoning?: ReasoningEffort): string {
  const modelName = parseModelSpec(modelSpec)?.modelId ?? modelSpec;

  return `${modelName} · reasoning: ${reasoning ?? 'provider-default'}`;
}
