import { expect, it } from 'vitest';

import { chatScope } from '../chat-scope.js';
import { SubagentScopes } from './scope.js';

it('never drops a chat whose subagents are still running', async () => {
  const scopes = new SubagentScopes(1);
  let finish!: () => void;
  const busy = chatScope.run('busy', () => scopes.current());
  const running = busy.gate.run(() => new Promise<void>((resolve) => (finish = resolve)));
  await Promise.resolve();

  chatScope.run('other', () => scopes.current());

  expect(chatScope.run('busy', () => scopes.current())).toBe(busy);

  finish();
  await running;
  chatScope.run('other', () => scopes.current());

  expect(chatScope.run('busy', () => scopes.current())).not.toBe(busy);
});
