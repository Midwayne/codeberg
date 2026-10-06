import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { DEFAULT_LEARNING_SETTINGS } from './preferences.js';
import { writeAtomic } from './fs.js';
import { LearningStore, serializeArtifact } from './store.js';
import { learningToolSource } from './tools.js';
import { observeSources, sourceHashes } from './memory-source.js';
import { sourceRevision } from './datasets.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('excludes unverified and legacy knowledge from agent recall while retaining audit access', async () => {
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
  expect(hits).toEqual([]);
  expect(await store.searchKnowledge('"remaining available units" meaning definition', 10, { includeUnverified: true })).toMatchObject([
    { artifact: { title: 'Calculate MPM remaining available units', status: 'needs_verification' } },
    { artifact: { title: 'Old remaining available units', status: 'needs_verification' } },
  ]);
  expect((await store.knowledgeArtifacts()).find((artifact) => artifact.id === 'knowledge-legacy-units')?.status).toBe('active');
  const filtered = await learningToolSource(store, () => ({ ...DEFAULT_LEARNING_SETTINGS,
    categories: { ...DEFAULT_LEARNING_SETTINGS.categories, flows: false } })).tools();
  const filteredSearch = filtered.search_knowledge as typeof search;
  expect(await filteredSearch.execute({ query: 'remaining available units', limit: 10 }, {})).toEqual([]);

});

it('rechecks source edits, commits and corrections on every recall using the same tool', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codeberg-knowledge-tool-'));
  roots.push(root);
  const repo = join(root, 'repo');
  await mkdir(repo);
  const path = join(repo, 'Flow.ts');
  const original = 'export const available = total - reserved;\n';
  await writeFile(path, original);
  let commit = 'commit-10am';
  const repositories = async () => [{ path: repo, commit }];
  const store = new LearningStore(join(root, 'learning'), repositories);
  await store.recordSession('inventory', [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Explain available inventory.' }] },
    { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Available inventory excludes reserved.' }] },
  ]);
  const attempt = (await store.attempts())[0];
  await store.recordFeedback({ attemptId: attempt.attempt_id, rating: 3, label: 'solved' });
  const interaction = await store.interaction(attempt.interaction_id);
  const ref = { repo, path: 'Flow.ts' };
  await writeAtomic(join(store.root, 'knowledge', 'flows', 'inventory.md'), serializeArtifact({
    id: 'inventory', slug: 'inventory', title: 'Available inventory', category: 'flows',
    created_at: '2026-10-06T10:00:00Z', updated_at: '2026-10-06T10:00:00Z', last_verified_at: '2026-10-06T10:00:00Z',
    repositories: [basename(repo)], source_interactions: [attempt.interaction_id],
    source_revision: sourceRevision(interaction.attempts, interaction.feedback),
    source_refs: [ref], source_hashes: sourceHashes(await observeSources([ref], await repositories())),
    source_commits: { [basename(repo)]: commit }, confidence: 'high', status: 'active',
    body: 'Available inventory excludes reserved.',
  }));
  const tools = await learningToolSource(store).tools();
  const search = tools.search_knowledge as { execute: (input: unknown, options: unknown) => Promise<unknown[]> };
  const recall = () => search.execute({ query: 'inventory' }, {});
  expect(await recall()).toHaveLength(1);

  // Noon edit, before a commit or any background refresh has run.
  await writeFile(path, 'export const available = total;\n');
  expect(await recall()).toEqual([]);
  expect(await store.searchKnowledge('inventory', 10, { includeUnverified: true })).toMatchObject([
    { artifact: { status: 'needs_verification' } },
  ]);

  await writeFile(path, original);
  expect(await recall()).toHaveLength(1);
  commit = 'commit-12pm';
  expect(await recall()).toEqual([]);

  commit = 'commit-10am';
  expect(await recall()).toHaveLength(1);
  await store.recordFeedback({ attemptId: attempt.attempt_id, rating: 0, label: 'not_useful' });
  expect(await recall()).toEqual([]);
});
