import { describe, expect, it } from 'vitest';

import type { DatasetExample } from './datasets.js';
import { scoreRetrievalRuns } from './metrics.js';

const evalRow = {
  id: 'eval-1',
  kind: 'retrieval',
  source_interaction_id: 'interaction-1',
  query: 'Where is inventoryAvailability produced?',
  state: 'eval',
  extraction_version: 2,
  source_revision: 'revision',
  extracted_at: '2026-01-01',
  feedback: [],
  provenance: 'user_confirmed',
  confidence: 'verified',
  payload: {},
  repositories: [{ name: 'inventory', commit: 'abc123' }],
  review: {
    oracle: {
      files: ['src/InventoryCalculator.kt'],
      repositories: ['inventory'],
      symbols: ['calculateAvailability'],
      dependency_path: ['client', 'producer'],
    },
    provenance: 'user_confirmed',
    timestamp: '2026-01-01',
  },
} satisfies DatasetExample;

describe('held-out retrieval metrics', () => {
  it('scores ranked hits and raw costs against a versioned oracle', () => {
    const report = scoreRetrievalRuns(
      [evalRow],
      [
        {
          eval_id: 'eval-1',
          hits: [
            { repo: 'inventory', path: 'src/AvailabilityClient.kt' },
            {
              repo: 'inventory',
              path: 'src/InventoryCalculator.kt',
              symbol: 'calculateAvailability',
            },
          ],
          success: true,
          tool_calls: 4,
          retrieved_tokens: 1200,
          latency_ms: 900,
        },
      ],
    );

    expect(report).toMatchObject({
      evaluated: 1,
      missing: 0,
      summary: { recall_at_1: 0, recall_at_5: 1, task_success: 1, tool_calls: 4, latency_ms: 900 },
      by_complexity: { 'single-repo/single-file/short-path': { count: 1, recall_at_5: 1 } },
      results: [
        {
          repository_commits: [{ name: 'inventory', commit: 'abc123' }],
          oracle_symbol_hit: true,
          dependency_hops: 1,
        },
      ],
    });
  });

  it('reports missing runs instead of treating them as zero-recall failures', () => {
    expect(scoreRetrievalRuns([evalRow], [])).toMatchObject({
      evaluated: 0,
      missing: 1,
      summary: { recall_at_5: null },
    });
  });
});
