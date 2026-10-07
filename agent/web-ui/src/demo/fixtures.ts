import { DEFAULT_LEARNING_SETTINGS } from '@agent/core/learning/preferences';
import type { ModelSettings } from '../lib/models';
import type { ProjectCatalog } from '../lib/project-api';
import type { ReviewDashboard, ReviewExample } from '../lib/training';

export const projects: ProjectCatalog = {
  defaultId: 'demo',
  projects: [{ id: 'demo', name: 'Codeberg demo', roots: [{ key: 'demo', root: '/demo/codeberg' }],
    configDirectory: '/demo/config' }],
  catalogPath: '/demo/projects.json',
};

export const models: ModelSettings = {
  models: [{ key: 'demo:model', model: 'demo:model', provider: 'demo', label: 'Demo model',
    contextWindow: 128000, efforts: ['low', 'high'], inputs: ['text'] }],
  chat: { key: 'demo:model', effort: 'low' },
  learning: { key: 'demo:model', effort: 'low' },
};

export const canvas = { enabled: true };
export const learning = structuredClone(DEFAULT_LEARNING_SETTINGS);
export const extensions = {
  mcps: [{ name: 'Repository tools', kind: 'builtin', scope: 'project' }],
  skills: [{ name: 'Code review', description: 'Review repository changes', scope: 'global' }],
  warnings: [],
};

export const review: ReviewDashboard = {
  stats: { total: 1, ready: 1, training: 0, eval: 0, dismissed: 0, stale: 0, by_kind: { sft: 1 } },
  candidates: [{ id: 'example', kind: 'sft', query: 'How does incremental indexing work?',
    extracted_at: new Date().toISOString(), state: 'ready', eligible: true,
    repositories: ['Codeberg demo'], answer_preview: 'The watcher schedules changed files for indexing.', proposed_files: [] }],
};

export const example: ReviewExample = {
  id: 'example', kind: 'sft', query: 'How does incremental indexing work?',
  payload: { answer: 'The watcher schedules changed files for indexing. The indexer replaces their semantic chunks.' },
  feedback: [], repositories: [{ name: 'Codeberg demo' }], provenance: 'Simulated demo example', confidence: 'high',
};
