import type { DecisionAnswer, DecisionQuestion } from './types.js';
import { record } from './record.js';

/** Normalize OpenAI arrays and System One maps without inventing missing probabilities. */
export function decisionDistribution(question: DecisionQuestion, raw: unknown): DecisionAnswer['probabilities'] {
  if (raw === undefined || question.type === 'predicate') return undefined;

  const options = question.type === 'choice' ? question.choices!.map((item) => item.value)
    : question.levels!.map((_level, index) => index);
  const mapped = Array.isArray(raw) ? raw.map((item: unknown) => record(item))
    : Object.entries(record(raw) ?? {}).map(([value, probability]) => ({ value, probability }));
  const entries = mapped.map((item) => ({
    value: question.type === 'score' ? levelIndex(item?.value) : item?.value,
    probability: item?.probability,
  }));
  if (entries.length !== options.length || new Set(entries.map((item) => item.value)).size !== options.length ||
    entries.some((item) => !options.some((option) => option === item.value) || !probability(item.probability)) ||
    Math.abs(entries.reduce((sum, item) => sum + Number(item.probability), 0) - 1) > 0.02) {
    throw new Error(`Invalid decision answer distribution: ${question.name}`);
  }

  return options.map((value) => ({ value,
    probability: entries.find((item) => item.value === value)!.probability as number,
    ...(question.type === 'score' ? { label: question.levels![Number(value)] } : {}),
  }));
}

function probability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function levelIndex(value: unknown): number {
  return typeof value === 'number' ? value
    : typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) ? Number(value) : NaN;
}
