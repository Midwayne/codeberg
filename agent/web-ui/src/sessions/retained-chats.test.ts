import { expect, it } from 'vitest';

import { retainChatViews } from './retained-chats';
import { createWorkspaceChat } from './workspace-chat';

function chat(id: string) {
  return createWorkspaceChat({ id, messages: [], persist: async () => {} });
}

it('keeps an eight-chat working set warm across repeated switches', () => {
  const chats = Array.from({ length: 8 }, (_, index) => chat(String(index)));
  let views = chats.reduce(retainChatViews, []);

  for (let cycle = 0; cycle < 3; cycle++) {
    for (const active of chats) {
      expect(views).toContain(active);

      views = retainChatViews(views, active);

      expect(views[0]).toBe(active);
      expect(new Set(views)).toEqual(new Set(chats));
    }
  }
});

it('bounds retained views and evicts only the least recently viewed UI', () => {
  const chats = Array.from({ length: 9 }, (_, index) => chat(String(index)));
  const first = chats[0]!;
  const second = chats[1]!;
  second.draft.text = 'Keep this unsent question';
  let views = chats.slice(0, 8).reduce(retainChatViews, []);

  views = retainChatViews(views, first);
  views = retainChatViews(views, chats[8]!);

  expect(views).toEqual([chats[8], first, ...chats.slice(2, 8).reverse()]);
  expect(views).not.toContain(second);
  expect(second.disposed).toBe(false);
  expect(second.draft.text).toBe('Keep this unsent question');
  expect(first.draft.text).toBe('');
});

it('drops deleted chat views and replaces an old instance with the same ID', async () => {
  const deleted = chat('deleted');
  const old = chat('same-id');
  const replacement = chat('same-id');

  await deleted.dispose();
  const views = retainChatViews([old, deleted], replacement);

  expect(views).toEqual([replacement]);
});
