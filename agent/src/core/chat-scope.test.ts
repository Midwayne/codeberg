import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { writeChatSideFile } from './chat-scope.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

it('removes a side file whose chat was deleted while it was being written', async () => {
  const sessions = mkdtempSync(join(tmpdir(), 'cberg-side-'));
  dirs.push(sessions);
  const file = join(sessions, '.worklists', 'chat.json');

  // The record exists at the first check and is gone after the write, as when deletion runs in between.
  const answers = [true, false];
  const written = await writeChatSideFile(file, '{}', async () => answers.shift()!);

  expect(written).toBe(false);
  expect(existsSync(file)).toBe(false);
});
