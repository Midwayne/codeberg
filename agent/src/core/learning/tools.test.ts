import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { DEFAULT_LEARNING_SETTINGS } from './preferences.js';
import { writeAtomic } from './fs.js';
import { LearningStore, serializeArtifact } from './store.js';
import { learningToolSource } from './tools.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('finds matching knowledge needing verification and exposes its status to the agent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codeberg-knowledge-tool-'));
  roots.push(root);
  const store = new LearningStore(root);
  await writeAtomic(join(root, 'knowledge', 'flows', 'remaining-available-units.md'), serializeArtifact({
    id: 'knowledge-units', title: 'Calculate MPM remaining available units',
    category: 'flows', slug: 'remaining-available-units',
    created_at: '2026-09-26', updated_at: '2026-09-26', last_verified_at: '2026-09-26',
    repositories: ['core'], source_interactions: ['interaction-units'], source_commits: {},
    confidence: 'medium', status: 'needs_verification',
    body: '## Definition\nremaining available units = total open units - store-close open units',
  }));
  await writeAtomic(join(root, 'knowledge', 'flows', 'legacy-units.md'), serializeArtifact({
    id: 'knowledge-legacy-units', title: 'Old remaining available units',
    category: 'flows', slug: 'legacy-units',
    created_at: '2026-09-25', updated_at: '2026-09-25', last_verified_at: '2026-09-25',
    repositories: ['core'], source_interactions: ['interaction-old-units'], source_commits: {},
    confidence: 'medium', status: 'active', body: 'Old remaining available units notes.',
  }));
  expect(await store.searchKnowledge('"remaining available units" meaning definition')).toEqual([]);

  const tools = await learningToolSource(store).tools();
  const search = tools.search_knowledge as { execute: (input: unknown, options: unknown) => Promise<unknown> };
  const hits = await search.execute({ query: '"remaining available units" meaning definition', limit: 10 }, {
    toolCallId: 'search-1', messages: [], abortSignal: new AbortController().signal,
  });
  expect(hits).toMatchObject([
    { artifact: { title: 'Calculate MPM remaining available units', status: 'needs_verification' } },
    { artifact: { title: 'Old remaining available units', status: 'needs_verification' } },
  ]);
  expect((await store.knowledgeArtifacts()).find((artifact) => artifact.id === 'knowledge-legacy-units')?.status).toBe('active');
  const filtered = await learningToolSource(store, () => ({ ...DEFAULT_LEARNING_SETTINGS,
    categories: { ...DEFAULT_LEARNING_SETTINGS.categories, flows: false } })).tools();
  const filteredSearch = filtered.search_knowledge as typeof search;
  expect(await filteredSearch.execute({ query: 'remaining available units', limit: 10 }, {})).toEqual([]);

});
