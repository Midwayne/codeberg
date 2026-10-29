import { jsonSchema } from 'ai';
import type { DecisionToolInput } from './types.js';

const question = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['name', 'type', 'instructions'],
  properties: {
    name: { type: 'string' as const, minLength: 1, maxLength: 64 },
    type: { type: 'string' as const, enum: ['predicate', 'choice', 'score'] },
    instructions: { type: 'string' as const, minLength: 1, maxLength: 4000 },
    choices: {
      type: 'array' as const, minItems: 2, maxItems: 64,
      description: 'Required only for choice. Distinct candidate values with optional descriptions.',
      items: {
        type: 'object' as const, additionalProperties: false, required: ['value'],
        properties: {
          value: { type: 'string' as const, minLength: 1, maxLength: 500 },
          description: { type: 'string' as const, minLength: 1, maxLength: 4000 },
        },
      },
    },
    levels: {
      type: 'array' as const, minItems: 2, maxItems: 10,
      description: 'Required only for score. Rubric descriptions ordered from lowest (index 0) to highest.',
      items: { type: 'string' as const, minLength: 1, maxLength: 4000 },
    },
  },
};

const file = {
  type: 'object' as const, additionalProperties: false, required: ['repo', 'path'],
  properties: {
    repo: { type: 'string' as const, minLength: 1, maxLength: 128 },
    path: { type: 'string' as const, minLength: 1, maxLength: 1024 },
    start_line: { type: 'integer' as const, minimum: 1 },
    end_line: { type: 'integer' as const, minimum: 1 },
  },
};

export const decisionSchema = jsonSchema<DecisionToolInput>({
  type: 'object', additionalProperties: false, required: ['state'],
  properties: {
    state: { type: 'string', minLength: 1, maxLength: 48000,
      description: 'Task and shared evidence. With files, keep under 8000 characters; do not copy file bodies here.' },
    files: { type: 'array', minItems: 1, maxItems: 8, items: file,
      description: 'Optional repository-relative files/ranges to read only for the decisions model. Up to 200 lines and 4000 characters per file. Defaults to the first 200 lines. Never returned as source bodies.' },
    questions: { type: 'array', minItems: 1, maxItems: 64, items: question,
      description: 'Optional with files: omit for one independent relevance probability per file. Otherwise required. Batch independent judgments together.' },
  },
});
