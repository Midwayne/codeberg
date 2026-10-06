import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { agentSystemPrompt } from '../prompt.js';
import { DEFAULT_LEARNING_SETTINGS } from './preferences.js';
import { LearningService } from './service.js';
import { learningToolSource } from './tools.js';

const services: LearningService[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const service of services) {
    service.stop();
    await service.waitForCurrent();
  }

  services.length = 0;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'learning-settings-'));
  roots.push(root);
  const service = new LearningService({ root });
  services.push(service);

  return service;
}
it('persists partial updates, preserves component choices while paused, and rejects invalid settings', async () => {
  const service = await fixture();
  expect(await service.getSettings()).toEqual(DEFAULT_LEARNING_SETTINGS);
  await service.updateSettings({ knowledge: false, categories: { flows: false } });
  await service.updateSettings({ enabled: false });
  const second = new LearningService({ root: service.store.root });
  services.push(second);
  expect(await second.getSettings()).toMatchObject({
    enabled: false,
    knowledge: false,
    categories: { flows: false, services: true },
  });
  await expect(service.updateSettings({ evals: 'false' })).rejects.toThrow(/boolean/);
  await expect(service.updateSettings({ unknown: true })).rejects.toThrow(/unknown/);
  expect(
    JSON.parse(await readFile(join(service.store.root, 'settings.json'), 'utf8')).enabled,
  ).toBe(false);
});
it('does not record or enqueue while paused; resumes pending dataset jobs without enabling knowledge', async () => {
  const service = await fixture();
  await service.updateSettings({ enabled: false });
  await service.initialize();
  await service.recordSession('paused', [
    { id: 'u', role: 'user', parts: [{ type: 'text', text: 'Where?' }] },
    { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'Here.' }] },
  ]);
  expect(await service.store.events()).toEqual([]);
  await service.queue.enqueueDataset('pending');
  const extract = vi.spyOn(service.datasets, 'extract').mockResolvedValue([]);
  service.worker?.wake();
  await service.waitForCurrent();
  expect(extract).not.toHaveBeenCalled();
  expect(await service.activeJobs()).toBe(0);
  await service.updateSettings({ enabled: true, knowledge: false });
  await service.waitForCurrent();
  expect(extract).toHaveBeenCalledWith('pending', DEFAULT_LEARNING_SETTINGS.kinds);
});
it('removes disabled recall tools and their prompt instructions independently', async () => {
  const service = await fixture();
  await service.updateSettings({ knowledgeRecall: false });
  const tools = await learningToolSource(service.store, () => service.settings).tools();
  expect(Object.keys(tools)).toEqual(['search_learning']);
  const prompt = agentSystemPrompt({
    enabled: false,
    search: false,
    learning: { knowledge: false, history: true },
  });

  expect(prompt).not.toContain('search_knowledge');
  expect(prompt).toContain('search_learning');
});
it('leaves refresh-only jobs pending when automatic refresh is off', async () => {
  const root = await mkdtemp(join(tmpdir(), 'learning-refresh-settings-'));
  roots.push(root);
  const generate = vi.fn();
  const service = new LearningService({ root, generator: { generate } });
  services.push(service);
  await service.updateSettings({ knowledgeRefresh: false, datasets: false });
  await service.queue.enqueueKnowledge('refresh', { sourceRefresh: true });
  await service.initialize();
  await service.waitForCurrent();
  expect(await service.activeJobs()).toBe(0);
  expect(await service.queue.list('pending')).toHaveLength(1);
  expect(generate).not.toHaveBeenCalled();
});
it('returns a newly claimed job to pending if learning is paused before execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'learning-pause-claim-'));
  roots.push(root);
  const service = new LearningService({ root, generator: { generate: vi.fn() } });
  services.push(service);
  await service.updateSettings({ datasets: false });
  await service.queue.enqueueKnowledge('pause-race');
  let claimed!: () => void, proceed!: () => void;
  const ready = new Promise<void>((resolve) => {
    claimed = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    proceed = resolve;
  });
  const original = service.queue.claim.bind(service.queue);
  vi.spyOn(service.queue, 'claim').mockImplementation(async (...args) => {
    const job = await original(...args);
    claimed();
    await gate;

    return job;
  });
  const running = service.worker!.runUntilIdle();
  await ready;
  await service.updateSettings({ enabled: false });
  proceed();
  await running;
  expect(await service.queue.list('pending')).toHaveLength(1);
  expect(await service.queue.list('failed')).toEqual([]);
});
it('retains recall while recording, extraction, and refresh are disabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'learning-recall-only-'));
  roots.push(root);
  const generate = vi.fn();
  const service = new LearningService({ root, generator: { generate } });
  services.push(service);
  await service.updateSettings({
    knowledgeCapture: false,
    knowledgeRefresh: false,
    historyCapture: false,
  });
  await service.queue.enqueueKnowledge('capture');
  await service.queue.enqueueKnowledge('refresh', { sourceRefresh: true });
  await service.initialize();
  await service.waitForCurrent();
  expect(await service.activeJobs()).toBe(0);
  expect(await service.queue.list('pending')).toHaveLength(2);
  expect(
    Object.keys(await learningToolSource(service.store, () => service.settings).tools()),
  ).toEqual(['search_learning', 'search_knowledge']);
  expect(generate).not.toHaveBeenCalled();
});
