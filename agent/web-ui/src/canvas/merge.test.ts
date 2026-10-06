import { expect, it } from 'vitest';
import { mergeScenes } from './merge';
import type { Scene } from '@agent/core/canvas/types';

const base = { name: 'flow', revision: 1, elements: [
  { id: 'api', type: 'rectangle', x: 100, version: 1 },
  { id: 'note', type: 'text', text: 'Old', version: 1 },
], appState: {}, files: {} } as Scene;

it('merges simultaneous edits to different elements and preserves deletions', () => {
  const local = structuredClone(base);
  local.elements[0]!.x = 900;
  const remote = structuredClone(base);
  remote.revision++;
  remote.elements[1]!.text = 'Agent note';
  const merged = mergeScenes(base, local, remote);

  expect(merged.elements[0]!.x).toBe(900);
  expect(merged.elements[1]!.text).toBe('Agent note');
  expect(merged.revision).toBe(2);
});

it('does not silently replace overlapping edits or edits made during canvas switches', () => {
  const local = structuredClone(base);
  local.elements[0]!.x = 900;
  const remote = structuredClone(base);
  remote.elements[0]!.x = 500;

  expect(() => mergeScenes(base, local, remote)).toThrow(/overlap/i);
  expect(() => mergeScenes(base, local, { ...remote, name: 'other' })).toThrow(/switched/i);
});
