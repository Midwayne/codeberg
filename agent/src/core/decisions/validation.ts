import type { DecisionAnswer, DecisionQuestion, DecisionRequest } from './types.js';
import { decisionDistribution } from './distribution.js';
import { record } from './record.js';

export { record } from './record.js';

function text(value: unknown, max = 4000): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

export function validateRequest(input: DecisionRequest): void {
  if (!text(input.state, 48000)) throw new Error('Decision state must contain 1–48000 characters');

  if (input.evidence !== undefined && (!text(input.evidence, 48000) || input.state.length + input.evidence.length > 48000)) {
    throw new Error('Decision state and file evidence must fit within 48000 characters; narrow the file ranges');
  }

  if (JSON.stringify(input).length > 128000) throw new Error('Decision request exceeds 128000 characters; batch fewer questions');

  if (!Array.isArray(input.questions) || !input.questions.length || input.questions.length > 64) {
    throw new Error('Decisions require 1–64 questions');
  }

  const names = new Set<string>();
  for (const question of input.questions) {
    if (!question || !text(question.name, 64) || names.has(question.name)) {
      throw new Error('Decision question names must be nonempty and unique (max 64 characters)');
    }

    names.add(question.name);
    if (!text(question.instructions)) throw new Error('Decision instructions must contain 1–4000 characters');

    validateQuestion(question);
  }
}

function validateQuestion(question: DecisionQuestion): void {
  if (question.type === 'predicate' && !question.choices && !question.levels) return;

  const choices = question.choices;
  if (question.type === 'choice' && !question.levels && Array.isArray(choices) &&
    choices.length >= 2 && choices.length <= 64 &&
    choices.every((item) => item && text(item.value, 500) &&
      (item.description === undefined || text(item.description))) &&
    new Set(choices.map((item) => item.value)).size === choices.length) return;

  const levels = question.levels;
  if (question.type === 'score' && !choices && Array.isArray(levels) &&
    levels.length >= 2 && levels.length <= 10 && levels.every((level) => text(level))) return;

  throw new Error(`Invalid decision question: ${question.name}`);
}

function bounded(value: unknown, maximum = 1): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum;
}

export function validateAnswer(question: DecisionQuestion, raw: unknown): DecisionAnswer {
  const answer = record(raw);
  if (answer?.type === 'refusal') return { name: question.name, type: 'refusal' };

  const valid = answer?.type === question.type && (
    question.type === 'predicate' ? bounded(answer.probability) :
      question.type === 'choice' ? question.choices!.some((item) => item.value === answer.choice) :
        bounded(answer.score, question.levels!.length - 1)
  );
  if (!answer || !valid || (answer.confidence !== undefined && !bounded(answer.confidence))) {
    throw new Error(`Invalid decision answer: ${question.name}`);
  }

  return {
    name: question.name, type: question.type,
    ...(question.type === 'predicate' ? { probability: answer.probability as number } : {}),
    ...(question.type === 'choice' ? { choice: answer.choice as string } : {}),
    ...(question.type === 'score' ? { score: answer.score as number } : {}),
    ...(answer.confidence !== undefined ? { confidence: answer.confidence as number } : {}),
    ...(answer.probabilities !== undefined ? { probabilities: decisionDistribution(question, answer.probabilities) } : {}),
  };
}
