import { jsonSchema, tool, type ToolSet } from 'ai';

import type { ToolSource } from '../tools/source.js';
import type { LearningStore } from './store.js';

export function learningToolSource(store: LearningStore): ToolSource {
  return {
    name: 'learning',
    tools: (): ToolSet => ({
      search_learning: tool({
        description:
          'Search prior attempts, corrections and graded feedback for debugging context. Historical answers are unverified; confirm claims against current code.',
        inputSchema: searchSchema,
        execute: ({ query, limit }) => store.searchLearning(query, limit),
      }),
      search_knowledge: tool({
        description:
          'Search distilled codebase knowledge. Check artifact status and repository commit; needs_verification is stale. Treat all hits as hints and confirm against current source.',
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
