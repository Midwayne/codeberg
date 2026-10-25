import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UIMessage } from 'ai';
import { afterEach, expect, it } from 'vitest';

import { WebSessionStore } from '../sessions/store.js';
import type { RunInput } from './types.js';
import { validateHistory } from './validation.js';

const directories: string[] = [];
const history: UIMessage[] = [
  { id: 'question', role: 'user', parts: [{ type: 'text', text: 'Find auth' }] },
  { id: 'answer', role: 'assistant', parts: [
    { type: 'reasoning', id: 'reasoning-1', text: 'Checking callers', state: 'done' },
    { type: 'text', text: 'Found auth.ts', state: 'done' },
  ] },
];
const followUp: UIMessage = { id: 'follow-up', role: 'user', parts: [{ type: 'text', text: 'What calls it?' }] };

async function fixture(messages = history) {
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-history-'));
  directories.push(directory);
  const sessions = new WebSessionStore(directory);
  await sessions.upsert({ id: 'chat', title: 'Find auth', messages, serverRunId: 'run' });

  return sessions;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

it('accepts browser SDK differences and uses the server-owned assistant history', async () => {
  const sessions = await fixture();
  const browserHistory = structuredClone(history);
  delete (browserHistory[1]!.parts[0] as { id?: string }).id;
  const input: RunInput = { chatId: 'chat', requestId: 'next', messages: [...browserHistory, followUp] };

  await expect(validateHistory(sessions, input)).resolves.toBeUndefined();

  expect(input.messages).toEqual([...history, followUp]);
});

it('replaces a partial or altered browser answer with the authoritative saved answer', async () => {
  const sessions = await fixture();
  const browserHistory = structuredClone(history);
  browserHistory[1]!.parts = [{ type: 'text', text: 'Found' }];
  const input: RunInput = { chatId: 'chat', requestId: 'next', messages: [...browserHistory, followUp] };

  await validateHistory(sessions, input);

  expect(input.messages).toEqual([...history, followUp]);
  expect((await sessions.load('chat'))?.messages).toEqual(history);
});

it.each(['missing answer', 'replaced answer', 'changed question', 'changed role'])('rejects a conflicting transcript: %s', async (scenario) => {
  const sessions = await fixture();
  const browserHistory = structuredClone(history);
  if (scenario === 'missing answer') browserHistory.pop();
  if (scenario === 'replaced answer') browserHistory[1]!.id = 'old-answer';
  if (scenario === 'changed question') browserHistory[0]!.parts = [{ type: 'text', text: 'Changed question' }];
  if (scenario === 'changed role') browserHistory[1]!.role = 'user';

  await expect(validateHistory(sessions, {
    chatId: 'chat', requestId: 'next', messages: [...browserHistory, followUp],
  })).rejects.toMatchObject({ status: 409 });
});

it('rejects a tab that has missed a completed turn', async () => {
  const sessions = await fixture([...history, followUp, {
    id: 'next-answer', role: 'assistant', parts: [{ type: 'text', text: 'main.ts calls it' }],
  }]);

  await expect(validateHistory(sessions, {
    chatId: 'chat', requestId: 'next', messages: [...history, { ...followUp, id: 'other-question' }],
  })).rejects.toMatchObject({ status: 409 });
});

it('uses authoritative earlier answers during regeneration too', async () => {
  const sessions = await fixture([...history, followUp, {
    id: 'next-answer', role: 'assistant', parts: [{ type: 'text', text: 'main.ts calls it' }],
  }]);
  const browserHistory = structuredClone(history);
  delete (browserHistory[1]!.parts[0] as { id?: string }).id;
  const input: RunInput = { chatId: 'chat', requestId: 'regenerate', trigger: 'regenerate-message',
    messages: [...browserHistory, followUp] };

  await validateHistory(sessions, input);

  expect(input.messages).toEqual([...history, followUp]);
});
