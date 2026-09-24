import type { ReasoningEffort } from '../core/types.js';

/** Browser title shared by the SPA metadata endpoint and fallback page. */
export function formatWebTitle(modelSpec: string, reasoning?: ReasoningEffort): string {
  const modelName = modelSpec.slice(modelSpec.indexOf(':') + 1);
  return `${modelName} · reasoning: ${reasoning ?? 'provider-default'}`;
}
