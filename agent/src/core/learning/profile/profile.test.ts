import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { LearningService } from '../service.js';
import { applyProfileUpdate } from './apply.js';
import { PROFILE_SYSTEM } from './prompt.js';
import { parseProfileUpdate } from './response.js';
import type { ProfileNote } from './types.js';

const roots: string[] = [];
const services: LearningService[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) {
    service.stop();
    await service.waitForCurrent();
  }

  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const userText = ['Please always answer with a table and keep it short.'];

it('keeps grounded notes and drops invented, malformed or identifying ones', () => {
  const update = parseProfileUpdate(
    'Sure:\n' +
      JSON.stringify({
        add: [
          { kind: 'preference', statement: 'Prefers tables.', evidence: 'always answer with a TABLE' },
          { kind: 'preference', statement: 'Likes emoji.', evidence: 'use emoji everywhere' },
          { kind: 'mood', statement: 'Is happy.', evidence: 'keep it short' },
          { kind: 'context', statement: 'Email is a@b.co', evidence: 'keep it short' },
          'not an object',
        ],
        update: [{ id: 'profile-1', statement: 'Wants short answers.', evidence: 'keep it short.' }],
        remove: ['profile-2', 3],
      }),
    userText,
  );

  expect(update.add).toEqual([
    { kind: 'preference', statement: 'Prefers tables.', evidence: 'always answer with a TABLE' },
  ]);
  expect(update.update.map((entry) => entry.id)).toEqual(['profile-1']);
  expect(update.remove).toEqual(['profile-2']);

  expect(() => parseProfileUpdate('no json here', userText)).toThrow(/malformed profile update/);
});

it('updates, removes and de-duplicates notes, newest first', () => {
  const note = (id: string, statement: string, updated_at: string): ProfileNote => ({
    id,
    kind: 'preference',
    statement,
    evidence: 'keep it short',
    source_interactions: ['i0'],
    created_at: updated_at,
    updated_at,
  });

  const notes = applyProfileUpdate(
    [note('profile-1', 'Wants short answers.', '2026-01-01'), note('profile-2', 'Old.', '2026-01-02')],
    {
      add: [{ kind: 'preference', statement: 'wants short answers.', evidence: 'keep it short' }],
      update: [],
      remove: ['profile-2'],
    },
    'i1',
    '2026-02-01',
  );

  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({
    id: 'profile-1',
    statement: 'wants short answers.',
    source_interactions: ['i0', 'i1'],
    updated_at: '2026-02-01',
  });
});

it('learns from every answer, without a rating, and adds the profile to chat context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codeberg-profile-'));
  roots.push(root);

  const generate = vi.fn(async ({ system }: { system: string; prompt: string }) =>
    system === PROFILE_SYSTEM
      ? JSON.stringify({
          add: [{ kind: 'preference', statement: 'Prefers answers as tables.', evidence: 'answer with a table' }],
          update: [],
          remove: [],
        })
      : '{"action":"none"}',
  );

  const service = new LearningService({ root, generator: { generate } });
  services.push(service);
  await service.initialize();

  await service.recordSession('c', [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: userText[0] }] },
    { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '| a | b |' }] },
  ]);

  await vi.waitFor(async () => expect(await service.profile.list()).toHaveLength(1), { timeout: 2_000 });

  const context = await service.profileContext();

  expect(context).toContain('How this user works');
  expect(context).toContain('Prefers answers as tables.');

  await service.updateSettings({ profile: false });

  expect(await service.profileContext()).toBe('');
});
