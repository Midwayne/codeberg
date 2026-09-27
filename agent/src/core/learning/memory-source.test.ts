import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { UIMessage } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LearningService } from './service.js';
import { memorySourceState, observeSources } from './memory-source.js';
import { DurableJobQueue } from './queue.js';
import { KnowledgeWorker } from './worker.js';
import { stableId } from './store.js';

const roots: string[] = [];
const services: LearningService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) {
    service.stop();
    await service.waitForCurrent();
  }
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'codeberg-memory-'));
  roots.push(root);
  const repo = join(root, 'inventory-service');
  await mkdir(join(repo, 'src'), { recursive: true });
  const path = join(repo, 'src', 'Flow.ts');
  await writeFile(path, 'export function getFlow() { return "old-process"; }');
  let commit = 'commit-A';
  let available = true;
  const repositories = async () => available ? [{ path: repo, commit }] : [];
  const generate = vi.fn(async ({ prompt }: { prompt: string }) => {
    const input = JSON.parse(prompt) as { mode: string; current_source_observations: { path: string; excerpt: string }[] };
    const source = input.current_source_observations.find((item) => item.excerpt?.includes('getFlow'));
    return JSON.stringify({ action: 'upsert', category: 'flows', slug: 'inventory-flow', title: 'Inventory flow',
      confidence: 'high', status: 'active', body: 'Unsupported model prose must not become memory.', claims: [{
        statement: `${source?.path ?? 'src/Flow.ts'}: ${source?.excerpt.includes('new-process') ? 'new-process' : 'old-process'}`,
        evidence: [{ repo: 'inventory-service', path: source?.path ?? 'src/Flow.ts',
          quote: source?.excerpt.includes('new-process') ? 'return "new-process"' : 'return "old-process"', symbol: 'getFlow' }],
      }] });
  });
  const service = new LearningService({ root: join(root, 'learning'), repositories, generator: { generate } });
  services.push(service);
  await service.initialize();
  const messages = [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'How does inventory flow work?' }] },
    { id: 'a1', role: 'assistant', parts: [
      { type: 'dynamic-tool', toolName: 'read_file', toolCallId: 't1', state: 'output-available',
        input: { path: 'src/Flow.ts' }, output: { path: 'src/Flow.ts', symbol: 'getFlow', body: 'return "old-process";' } },
      { type: 'text', text: 'The flow is in src/Flow.ts#getFlow.' },
    ] },
  ] as UIMessage[];
  await service.recordSession('c', messages);
  await service.feedback({ conversationId: 'c', messageId: 'a1', rating: 3, label: 'solved' });
  await service.waitForCurrent();
  return { root, repo, path, service, generate, repositories,
    setCommit: (value: string) => { commit = value; }, setAvailable: (value: boolean) => { available = value; } };
}

describe('source-aware codebase memory', () => {
  it('hides changed code immediately and refreshes an existing memory from fresh source', async () => {
    const { path, service, generate, repositories, setCommit } = await setup();
    const old = (await service.store.knowledgeArtifacts())[0];
    expect(old).toMatchObject({ status: 'active', body: expect.stringContaining('old-process'), source_refs: [{ path: 'src/Flow.ts', symbol: 'getFlow' }] });
    expect(old.body).not.toContain('Unsupported model prose');
    const cache = new Map();
    const firstScan = await memorySourceState(old, await repositories(), cache);
    const secondScan = await memorySourceState(old, await repositories(), cache);
    expect(firstScan.observations[0]).toBe(secondScan.observations[0]);
    expect((await service.store.searchKnowledge('inventory flow'))).toHaveLength(1);
    await service.refreshKnowledge();
    await service.waitForCurrent();
    expect(generate).toHaveBeenCalledTimes(1); // no work on an unchanged source

    await writeFile(path, 'export function getFlow() { return "new-process"; }\nAPI_KEY=verysecretvalue');
    expect(await service.store.searchKnowledge('inventory flow')).toEqual([]); // dirty tree, same commit
    await service.refreshKnowledge();
    await service.waitForCurrent();
    const updated = (await service.store.knowledgeArtifacts())[0];
    expect(updated).toMatchObject({ id: old.id, status: 'active', body: expect.stringContaining('new-process') });
    expect(updated.source_hashes).not.toEqual(old.source_hashes);
    expect(generate.mock.calls[1][0].prompt).not.toContain('verysecretvalue');
    expect((await service.store.searchKnowledge('inventory flow'))).toHaveLength(1);

    setCommit('commit-B');
    expect(await service.store.searchKnowledge('inventory flow')).toEqual([]);
    await service.refreshKnowledge();
    await service.waitForCurrent();
    expect((await service.store.knowledgeArtifacts())[0].source_commits['inventory-service']).toBe('commit-B');
    expect((await memorySourceState((await service.store.knowledgeArtifacts())[0], await repositories())).fresh).toBe(true);
    expect(generate).toHaveBeenCalledTimes(3);
    service.stop();
  });

  it('uses a cited-file change signal to refresh without waiting for the periodic scan', async () => {
    const { path, service } = await setup();
    await writeFile(path, 'export function getFlow() { return "new-process"; }');
    await vi.waitFor(async () => {
      expect((await service.store.knowledgeArtifacts())[0].body).toContain('new-process');
    }, { timeout: 4_000 });
    service.stop();
  });

  it('ignores unrelated file signals while preserving the cited memory', async () => {
    const { repo, service, generate } = await setup();
    await writeFile(join(repo, 'src', 'Unrelated.ts'), 'export const unrelated = 1;');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await service.store.searchKnowledge('inventory flow'))).toHaveLength(1);
    service.stop();
  });

  it('leaves missing code unverified, then recovers on restart when new source appears', async () => {
    const { root, path, service, generate, repositories, setCommit } = await setup();
    setCommit('commit-B');
    await unlink(path);
    expect(await service.store.searchKnowledge('inventory flow')).toEqual([]);
    await service.refreshKnowledge();
    await service.waitForCurrent();
    expect((await service.store.knowledgeArtifacts())[0].status).toBe('needs_verification');
    expect(generate).toHaveBeenCalledTimes(1); // never trust the historical answer after deletion
    service.stop();

    await writeFile(path, 'export function getFlow() { return "new-process"; }');
    const restarted = new LearningService({ root: join(root, 'learning'), repositories, generator: { generate } });
    services.push(restarted);
    await restarted.initialize();
    await restarted.waitForCurrent();
    expect((await restarted.store.knowledgeArtifacts())[0]).toMatchObject({ status: 'active', body: expect.stringContaining('new-process') });
    expect((await restarted.store.searchKnowledge('inventory flow'))).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(2);
    restarted.stop();
    expect((await readFile(path, 'utf8'))).toContain('new-process');
  });

  it('follows a moved symbol to its new file before updating the memory', async () => {
    const { repo, path, service, setCommit } = await setup();
    await writeFile(join(repo, 'src', 'NewFlow.ts'), 'export function getFlow() { return "new-process"; }');
    await unlink(path);
    setCommit('commit-B');
    expect(await service.store.searchKnowledge('inventory flow')).toEqual([]);
    await service.refreshKnowledge();
    await service.waitForCurrent();
    const artifact = (await service.store.knowledgeArtifacts())[0];
    expect(artifact).toMatchObject({ status: 'active', body: expect.stringContaining('src/NewFlow.ts: new-process'),
      source_refs: [{ path: 'src/NewFlow.ts', symbol: 'getFlow' }] });
    expect((await service.store.searchKnowledge('inventory flow'))).toHaveLength(1);
    service.stop();
  });

  it('rejects a refresh that cites only a deleted file', async () => {
    const { repo, path, service, generate, setCommit } = await setup();
    await writeFile(join(repo, 'src', 'NewFlow.ts'), 'export function getFlow() { return "new-process"; }');
    await unlink(path);
    setCommit('commit-B');
    generate.mockResolvedValueOnce(JSON.stringify({ action: 'upsert', category: 'flows', slug: 'inventory-flow',
      title: 'Inventory flow', confidence: 'high', status: 'active', claims: [{ statement: 'src/Flow.ts: old-process',
        evidence: [{ repo: 'inventory-service', path: 'src/Flow.ts', quote: 'return "old-process"' }] }] }));
    await service.refreshKnowledge();
    await service.waitForCurrent();
    expect((await service.store.knowledgeArtifacts())[0].status).toBe('needs_verification');
    expect(await service.store.searchKnowledge('inventory flow')).toEqual([]);
    service.stop();
  });

  it('recovers a refresh job interrupted before it could inspect changed code', async () => {
    const { root, path, service, generate, repositories, setCommit } = await setup();
    const interactionId = (await service.store.attempts())[0].interaction_id;
    service.stop();
    await writeFile(path, 'export function getFlow() { return "new-process"; }');
    setCommit('commit-B');
    let now = Date.now();
    const queue = new DurableJobQueue(join(root, 'learning'), () => new Date(now), 10);
    await queue.enqueueKnowledge(interactionId, { requeueCompleted: true });
    expect((await queue.claim())?.interaction_id).toBe(interactionId);
    now += 20;
    const worker = new KnowledgeWorker(service.store, queue, { generate });
    await worker.initialize();
    await vi.waitFor(async () => {
      expect((await queue.get(stableId('job', 'extract_knowledge', interactionId)))?.status).toBe('completed');
    });
    expect((await service.store.knowledgeArtifacts())[0].body).toContain('new-process');
    expect((await memorySourceState((await service.store.knowledgeArtifacts())[0], await repositories())).fresh).toBe(true);
    worker.stop();
  });

  it('does not read path traversal as current code evidence', async () => {
    const { repo, root, service, repositories } = await setup();
    await writeFile(join(root, 'private.txt'), 'API_KEY=secret-outside-repo');
    const [observation] = await observeSources([{ repo, path: '../private.txt' }], await repositories());
    expect(observation.unavailable).toBeDefined();
    expect(observation.excerpt).toBeUndefined();
    service.stop();
  });

  it('keeps a temporarily unavailable repository unverified and rechecks it on recovery', async () => {
    const { service, generate, setAvailable } = await setup();
    setAvailable(false);
    expect(await service.store.searchKnowledge('inventory flow')).toEqual([]);
    await service.refreshKnowledge();
    await service.waitForCurrent();
    expect((await service.store.knowledgeArtifacts())[0].status).toBe('needs_verification');
    expect(generate).toHaveBeenCalledTimes(1);
    setAvailable(true);
    await service.refreshKnowledge();
    await service.waitForCurrent();
    expect((await service.store.knowledgeArtifacts())[0].status).toBe('active');
    expect((await service.store.searchKnowledge('inventory flow'))).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(2);
    service.stop();
  });
});
