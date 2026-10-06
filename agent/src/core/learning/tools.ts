import { jsonSchema, tool, type ToolSet } from 'ai';

import { DEFAULT_LEARNING_SETTINGS, learningRecall, type LearningSettings } from './preferences.js';
import type { ToolSource } from '../tools/source.js';
import type { LearningStore } from './store.js';

export function learningToolSource(store: LearningStore, settings: () => LearningSettings = () => DEFAULT_LEARNING_SETTINGS): ToolSource {
  return {
    name: 'learning',
    tools: (): ToolSet => ({
      ...(learningRecall(settings()).history ? {
      search_learning: tool({
        description:
          'Search prior attempts, corrections and graded feedback for debugging context. Historical answers are unverified; confirm claims against current code.',
        inputSchema: searchSchema,
        execute: ({ query, limit }) => learningRecall(settings()).history ? store.searchLearning(query, limit) : [],
      }),
      } : {}),
      ...(learningRecall(settings()).knowledge ? { search_knowledge: tool({
        description:
          'Search distilled codebase knowledge whose tracked source files, repository commits and feedback revisions are current at read time. Stale and unverified records are excluded. Use artifact IDs or category/slug paths to follow related_ids and index entries. Confirm claims against current source before relying on them.',
        inputSchema: searchSchema,
        execute: ({ query, limit }) => learningRecall(settings()).knowledge ? store.searchKnowledge(query, limit, { categories: settings().categories }) : [],
      }),
      } : {}),
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
