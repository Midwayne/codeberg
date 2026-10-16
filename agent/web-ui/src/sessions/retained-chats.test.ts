import { expect, it } from 'vitest';

import { retainChatViews } from './retained-chats';
import { createWorkspaceChat } from './workspace-chat';

function chat(id: string) {
  return createWorkspaceChat({ id, messages: [], persist: async () => {} });
}

it('reuses recent chat instances and evicts only the least recently viewed UI', () => {
  const first = chat('first');
  const second = chat('second');
  const third = chat('third');
  const fourth = chat('fourth');
  second.draft.text = 'Keep this unsent question';
  let views = retainChatViews([], first);

  views = retainChatViews(views, second);
  views = retainChatViews(views, third);
  views = retainChatViews(views, first);
  views = retainChatViews(views, fourth);

  expect(views).toEqual([fourth, first, third]);
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
