import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { sourceRevision } from '../datasets.js';
import { writeAtomic } from '../fs.js';
import { observeSources, sourceCommits, sourceHashes } from '../memory-source.js';
import { LearningService } from '../service.js';
import { LearningStore, serializeArtifact } from '../store.js';
import type { KnowledgeArtifact } from '../types.js';
import { DreamingConsolidator } from './consolidator.js';
import { DreamingReports } from './reports.js';

const roots: string[] = [];
const services: LearningService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) {
    service.stop();
    await service.waitForCurrent();
  }

  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dreaming-'));
  roots.push(root);
  const repo = join(root, 'repo');
  await mkdir(repo);
  await writeFile(
    join(repo, 'Flow.ts'),
    'export const available = total - reserved;\nexport const allocated = reserved;\n',
  );
  const repositories = async () => [{ path: repo, commit: 'commit-1' }];
  const store = new LearningStore(join(root, 'learning'), repositories);
  const artifacts: KnowledgeArtifact[] = [];
  for (const [i, statement] of [
    'Available excludes reserved.',
    'Allocated means reserved.',
  ].entries()) {
    await store.recordSession(`c${i}`, [
      { id: `u${i}`, role: 'user', parts: [{ type: 'text', text: 'Explain inventory.' }] },
      { id: `a${i}`, role: 'assistant', parts: [{ type: 'text', text: statement }] },
    ]);
    const attempt = (await store.attempts()).find((a) => a.conversation_id === `c${i}`)!;
    await store.recordFeedback({ attemptId: attempt.attempt_id, rating: 3, label: 'solved' });
    const interaction = await store.interaction(attempt.interaction_id);
    const ref = { repo, path: 'Flow.ts' };
    const observations = await observeSources([ref], await repositories());
    const artifact: KnowledgeArtifact = {
      id: `knowledge-${i}`,
      slug: `inventory-${i}`,
      title: `Inventory ${i}`,
      category: 'flows',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      last_verified_at: '2026-01-01',
      repositories: [basename(repo)],
      source_interactions: [attempt.interaction_id],
      source_revision: sourceRevision(interaction.attempts, interaction.feedback),
      source_commits: sourceCommits(await repositories()),
      source_refs: [ref],
      source_hashes: sourceHashes(observations),
      claims: [
        {
          statement,
          evidence: [
            {
              repo: 'repo',
              path: 'Flow.ts',
              quote: i
                ? 'export const allocated = reserved;'
                : 'export const available = total - reserved;',
            },
          ],
        },
      ],
      confidence: 'high',
      status: 'active',
      body: statement,
    };

    artifacts.push(artifact);
    await writeAtomic(
      join(store.root, 'knowledge', 'flows', `${artifact.slug}.md`),
      serializeArtifact(artifact),
    );
  }

  const reports = new DreamingReports(store.root);
  const generate = vi.fn(async () =>
    JSON.stringify({
      merges: [
        {
          target_id: artifacts[0].id,
          source_ids: [artifacts[1].id],
          reason: 'Complementary inventory rules.',
        },
      ],
      links: [],
      summary: 'Consolidate inventory.',
    }),
  );

  const consolidator = new DreamingConsolidator(store, reports, { generate });

  return { root, repo, repositories, store, reports, consolidator, generate, artifacts };
}
it('proposes without changing recall, applies a lossless grounded view, and undoes it', async () => {
  const { store, reports, consolidator, artifacts } = await fixture();
  const report = await consolidator.plan('dream-test');
  expect(report.changes).toHaveLength(2);
  expect(await store.currentKnowledgeArtifacts()).toHaveLength(2);
  await reports.decide(report.id, 'apply', store);
  const current = await store.currentKnowledgeArtifacts();
  expect(current).toHaveLength(1);
  expect(current[0].claims).toHaveLength(2);
  expect(current[0].source_interactions).toEqual(
    expect.arrayContaining(artifacts.flatMap((a) => a.source_interactions)),
  );
  expect(await store.knowledgeArtifacts()).toHaveLength(2);
  expect(
    (await store.searchKnowledge('Allocated', 10, { includeUnverified: true })).every(
      (hit) => hit.artifact.id !== artifacts[1].id,
    ),
  ).toBe(true);
  await reports.decide(report.id, 'undo', store);
  expect(await store.currentKnowledgeArtifacts()).toHaveLength(2);
  expect((await reports.get(report.id))?.decisions.map((d) => d.action)).toEqual(['apply', 'undo']);
});
it('rejects a stale proposal instead of overwriting newer extraction', async () => {
  const { store, reports, consolidator, artifacts } = await fixture();
  const report = await consolidator.plan('dream-test');
  const changed = { ...artifacts[0], body: 'A newer investigation.' };
  await writeAtomic(
    join(store.root, 'knowledge', 'flows', `${changed.slug}.md`),
    serializeArtifact(changed),
  );
  await expect(reports.decide(report.id, 'apply', store)).rejects.toThrow(/stale/);
  expect((await store.currentKnowledgeArtifacts())[0].body).toBe(changed.body);
});
it('drops an applied view when its original knowledge or source evidence changes', async () => {
  const { store, reports, consolidator, repo } = await fixture();
  const report = await consolidator.plan('dream-test');
  await reports.decide(report.id, 'apply', store);
  await writeFile(join(repo, 'Flow.ts'), 'export const available = total;');
  expect(await store.currentKnowledgeArtifacts()).toEqual([]);
  await reports.decide(report.id, 'undo', store);
  expect(await store.currentKnowledgeArtifacts()).toEqual([]);
});
it('rejects invented IDs, overlapping merges, and malformed plans', async () => {
  const { consolidator, generate } = await fixture();
  generate.mockResolvedValueOnce(
    JSON.stringify({
      merges: [{ target_id: 'invented', source_ids: ['knowledge-1'], reason: 'x' }],
      links: [],
    }),
  );
  await expect(consolidator.plan('dream-test')).rejects.toThrow(/INVALID_RESPONSE/);
  generate.mockResolvedValueOnce(
    JSON.stringify({
      merges: [
        { target_id: 'knowledge-0', source_ids: ['knowledge-1'], reason: 'x' },
        { target_id: 'knowledge-1', source_ids: ['knowledge-0'], reason: 'x' },
      ],
      links: [],
    }),
  );
  await expect(consolidator.plan('dream-overlap')).rejects.toThrow(/INVALID_RESPONSE/);
});
it('reuses a durable report on job retry without another model call', async () => {
  const { consolidator, generate } = await fixture();
  await consolidator.plan('dream-test');
  await consolidator.plan('dream-test');
  expect(generate).toHaveBeenCalledTimes(1);
});
it('queues manual consolidation independently of solved-answer extraction and honors pause', async () => {
  const { store, repositories, generate } = await fixture();
  const service = new LearningService({ root: store.root, repositories, generator: { generate } });
  services.push(service);
  await service.updateSettings({
    knowledgeCapture: false,
    knowledgeRefresh: false,
    datasets: false,
  });
  await service.initialize();
  const job = await service.requestDreaming();
  await service.waitForCurrent();
  expect((await service.queue.get(job.job_id))?.status).toBe('completed');
  expect(await service.dreamingReports.list()).toHaveLength(1);
  await service.updateSettings({ enabled: false });
  await expect(service.requestDreaming()).rejects.toThrow(/paused/);
});
it('preserves provisional user notes separately from verified recall', async () => {
  const { store, reports, consolidator, artifacts } = await fixture();
  const artifact = {
    ...artifacts[0],
    user_confirmed_notes: [
      {
        interaction_id: artifacts[0].source_interactions[0],
        source_revision: artifacts[0].source_revision!,
        text: 'Confirm this special case with operations.',
        confirmed_at: '2026-01-01',
        provenance: 'user_confirmed' as const,
      },
    ],
    body:
      artifacts[0].body +
      '\n\n## User-confirmed notes (not source-verified)\n- Confirm this special case with operations.',
  };

  await writeAtomic(
    join(store.root, 'knowledge', 'flows', `${artifact.slug}.md`),
    serializeArtifact(artifact),
  );
  const report = await consolidator.plan('dream-notes');
  await reports.decide(report.id, 'apply', store);
  expect((await store.projectedKnowledgeArtifacts())[0].user_confirmed_notes).toHaveLength(1);
  expect((await store.currentKnowledgeArtifacts())[0].body).not.toContain('operations');
});
it('keeps unaffected original knowledge available after feedback on one merged note is downgraded', async () => {
  const { store, reports, consolidator } = await fixture();
  const report = await consolidator.plan('dream-feedback');
  await reports.decide(report.id, 'apply', store);
  const attempt = (await store.attempts())[0];
  await store.recordFeedback({ attemptId: attempt.attempt_id, rating: 0, label: 'not_useful' });
  expect(await store.currentKnowledgeArtifacts()).toHaveLength(1);
  expect((await store.currentKnowledgeArtifacts())[0].source_interactions).not.toContain(
    attempt.interaction_id,
  );
});
it('publishes only one decision revision under concurrent apply requests', async () => {
  const { store, reports, consolidator } = await fixture();
  const report = await consolidator.plan('dream-race');
  const results = await Promise.allSettled([
    reports.decide(report.id, 'apply', store),
    new DreamingReports(store.root).decide(report.id, 'apply', store),
  ]);

  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect((await reports.get(report.id))?.decisions).toHaveLength(1);
  expect(await store.currentKnowledgeArtifacts()).toHaveLength(1);
});
it('links distinct knowledge without merging claims', async () => {
  const { store, reports, consolidator, generate } = await fixture();
  generate.mockResolvedValueOnce(
    JSON.stringify({
      summary: 'Related inventory rules.',
      merges: [],
      links: [{ from_id: 'knowledge-0', to_id: 'knowledge-1', reason: 'Inventory concepts.' }],
    }),
  );
  const report = await consolidator.plan('dream-links');
  await reports.decide(report.id, 'apply', store);
  const current = await store.currentKnowledgeArtifacts();
  expect(current).toHaveLength(2);
  expect(current.find((artifact) => artifact.id === 'knowledge-0')?.related_ids).toEqual([
    'knowledge-1',
  ]);
  expect(current.every((artifact) => artifact.claims?.length === 1)).toBe(true);
});
it('schedules at most one durable daily proposal and keeps daily scheduling off by default', async () => {
  const { store, repositories, generate } = await fixture();
  const service = new LearningService({ root: store.root, repositories, generator: { generate } });
  services.push(service);
  await service.updateSettings({
    knowledgeCapture: false,
    knowledgeRefresh: false,
    datasets: false,
  });
  await service.initialize();
  await service.waitForCurrent();
  expect(await service.dreamingReports.list()).toEqual([]);
  await service.updateSettings({ dreaming: true });
  await service.waitForCurrent();
  await service.updateSettings({ dreaming: true });
  await service.waitForCurrent();
  expect(await service.dreamingReports.list()).toHaveLength(1);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(await store.currentKnowledgeArtifacts()).toHaveLength(2);
});
it('rotates bounded passes so old knowledge is eventually considered', async () => {
  const { store, consolidator, generate, artifacts } = await fixture();
  for (let i = 2; i < 40; i++) {
    const artifact = { ...artifacts[0], id: `knowledge-${i}`, slug: `inventory-${i}` };
    await writeAtomic(
      join(store.root, 'knowledge', 'flows', `${artifact.slug}.md`),
      serializeArtifact(artifact),
    );
  }

  generate.mockResolvedValue(
    JSON.stringify({ summary: 'No merge required.', merges: [], links: [] }),
  );
  const first = await consolidator.plan('dream-batch-one');
  const second = await consolidator.plan('dream-batch-two');
  expect(first.considered).toBe(32);
  expect(first.omitted).toBe(8);
  expect(new Set([...first.inputs!, ...second.inputs!].map((input) => input.id)).size).toBe(40);
});
it('lets the agent follow related IDs and startup index paths through knowledge search', async () => {
  const { store } = await fixture();
  expect((await store.searchKnowledge('knowledge-1'))[0]?.artifact.id).toBe('knowledge-1');
  expect((await store.searchKnowledge('[[flows/inventory-0]]'))[0]?.artifact.id).toBe(
    'knowledge-0',
  );
});
it('rejects merging claims whose quotes no longer match freshly read code', async () => {
  const { consolidator, generate, repo } = await fixture();
  generate.mockImplementationOnce(async () => {
    await writeFile(join(repo, 'Flow.ts'), 'export const available = total;');

    return JSON.stringify({
      summary: 'Merge inventory',
      merges: [{ target_id: 'knowledge-0', source_ids: ['knowledge-1'], reason: 'Same topic.' }],
      links: [],
    });
  });
  await expect(consolidator.plan('dream-changed-evidence')).rejects.toThrow(/evidence changed/);
});
it('never discards claims to fit the twelve-claim limit', async () => {
  const { store, consolidator, artifacts } = await fixture();
  for (const artifact of artifacts) {
    artifact.claims = Array.from({ length: 7 }, (_, i) => ({
      ...artifact.claims![0],
      statement: `${artifact.id} claim ${i}`,
    }));
    await writeAtomic(
      join(store.root, 'knowledge', 'flows', `${artifact.slug}.md`),
      serializeArtifact(artifact),
    );
  }

  await expect(consolidator.plan('dream-too-many-claims')).rejects.toThrow(/omit claims/);
  expect(
    (await store.currentKnowledgeArtifacts()).map((artifact) => artifact.claims!.length),
  ).toEqual([7, 7]);
});
it('falls back to original records when newer extraction changes an applied view input', async () => {
  const { store, reports, consolidator, artifacts } = await fixture();
  const report = await consolidator.plan('dream-old-input');
  await reports.decide(report.id, 'apply', store);
  const changed = { ...artifacts[0], body: 'Newly extracted knowledge.' };
  await writeAtomic(
    join(store.root, 'knowledge', 'flows', `${changed.slug}.md`),
    serializeArtifact(changed),
  );
  expect(await store.currentKnowledgeArtifacts()).toHaveLength(2);
  expect(
    (await store.currentKnowledgeArtifacts()).find((artifact) => artifact.id === changed.id)?.body,
  ).toBe(changed.body);
  await reports.decide(report.id, 'undo', store);
  expect(
    (await store.currentKnowledgeArtifacts()).find((artifact) => artifact.id === changed.id)?.body,
  ).toBe(changed.body);
});
