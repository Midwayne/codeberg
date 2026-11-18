import { jsonSchema, tool, type ToolSet } from 'ai';

import type { ToolSource } from '../tools/source.js';
import { DEFAULT_LEARNING_SETTINGS, learningRecall, type LearningSettings } from './preferences.js';
import type { LearningStore } from './store.js';
import { ProfileStore } from './profile/store.js';
import { rememberTools } from './profile/tools.js';
import { KnowledgeUsage } from './knowledge-usage.js';

export function learningToolSource(
  store: LearningStore,
  settings: () => LearningSettings = () => DEFAULT_LEARNING_SETTINGS,
): ToolSource {
  const usage = new KnowledgeUsage(store.root);

  return {
    name: 'learning',
    tools: (): ToolSet => ({
      ...(settings().enabled && settings().profile
        ? rememberTools(new ProfileStore(store.root))
        : {}),
      ...(learningRecall(settings()).history
        ? {
            search_learning: tool({
              description:
                'Search prior attempts, corrections and graded feedback for debugging context. Historical answers are unverified; confirm claims against current code.',
              inputSchema: searchSchema,
              execute: ({ query, limit }) =>
                learningRecall(settings()).history ? store.searchLearning(query, limit) : [],
            }),
          }
        : {}),
      ...(learningRecall(settings()).knowledge
        ? {
            search_knowledge: tool({
              description:
                'Search distilled codebase knowledge whose tracked source files, repository commits and feedback revisions are current at read time. Stale and unverified records are excluded. Use artifact IDs or category/slug paths to follow related_ids and index entries. Confirm claims against current source before relying on them.',
              inputSchema: searchSchema,
              execute: async ({ query, limit }) => {
                if (!learningRecall(settings()).knowledge) return [];

                const hits = await store.searchKnowledge(query, limit, {
                  categories: settings().categories,
                });

                // Usage is a convenience signal; a failed write never fails the search.
                await usage.record(hits.map((hit) => hit.artifact.id)).catch(() => undefined);

                return hits;
              },
            }),
          }
        : {}),
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
