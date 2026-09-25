import { jsonSchema, tool, type ToolSet } from 'ai';

import type { ToolSource } from '../tools/source.js';
import type { LearningStore } from './store.js';

export function learningToolSource(store: LearningStore): ToolSource {
  return {
    name: 'learning',
    tools: (): ToolSet => ({
      search_learning: tool({
        description:
          'Search raw graded interaction history. Use for prior attempts, corrections, and historical debugging context.',
        inputSchema: searchSchema,
        execute: ({ query, limit }) => store.searchLearning(query, limit),
      }),
      search_knowledge: tool({
        description:
          'Search distilled, provenance-backed codebase knowledge. Treat it as a hint and verify against current source.',
        inputSchema: searchSchema,
        execute: ({ query, limit }) => store.searchKnowledge(query, limit),
      }),
    }),
  };
}

const searchSchema = jsonSchema<{ query: string; limit?: number }>({
  type: 'object',
  additionalProperties: false,
  properties: {
    query: { type: 'string' },
    limit: { type: 'number', description: 'maximum results (default 10)' },
  },
  required: ['query'],
});
