import type { EvaluationConfiguration } from './automatic-types.js';

export function sameConfiguration(
  a: EvaluationConfiguration,
  b?: EvaluationConfiguration,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
