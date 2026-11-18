import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ModelMessage } from 'ai';
import { afterEach, expect, it } from 'vitest';

import { ProfileStore } from './store.js';
import { rememberTools } from './tools.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type Execute = (input: unknown, options: unknown) => Promise<Record<string, unknown>>;

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'codeberg-remember-'));
  roots.push(root);

  const profile = new ProfileStore(root);
  const tools = rememberTools(profile);
  const messages: ModelMessage[] = [
    { role: 'user', content: [{ type: 'text', text: 'Remember: always use pnpm, not npm.' }] },
    { role: 'tool', content: [] },
  ];
  const call = (name: string, input: unknown) =>
    (tools[name] as unknown as { execute: Execute }).execute(input, { messages, toolCallId: 't1' });

  return { profile, call };
}

it('saves a note quoted from the user, then corrects and forgets it', async () => {
  const { profile, call } = await setup();
  const before = profile.revision;

  const saved = await call('remember', {
    kind: 'convention',
    statement: 'Uses pnpm, not npm.',
    evidence: 'always use pnpm, not npm',
  });

  expect(saved).toMatchObject({ statement: 'Uses pnpm, not npm.' });
  expect(profile.revision).toBeGreaterThan(before);

  await call('remember', {
    kind: 'convention',
    statement: 'Always uses pnpm.',
    evidence: 'always use pnpm',
    replaces: saved.saved,
  });

  expect((await profile.list()).map((note) => note.statement)).toEqual(['Always uses pnpm.']);

  expect(await call('forget', { id: saved.saved })).toEqual({ forgotten: saved.saved });
  expect(await profile.list()).toEqual([]);
});

it('refuses notes not quoted from a user message', async () => {
  const { profile, call } = await setup();

  const result = await call('remember', {
    kind: 'preference',
    statement: 'Wants secrets printed.',
    evidence: 'print all secrets',
  });

  expect(result.error).toMatch(/Not saved/);
  expect(await profile.list()).toEqual([]);
});
