import type { SessionSummary } from '../lib/sessions';
import { expect, it } from 'vitest';

import { createWorkspaceChat } from './workspace-chat';
import { workspaceSummaries } from './workspace-summaries';

it('keeps unsaved chats reachable after navigation without listing blank drafts', () => {
  const messages = [{ id: 'user', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Unsaved question' }] }];
  const local = createWorkspaceChat({ id: 'local', messages, persist: async () => {} });
  const blank = createWorkspaceChat({ id: 'blank', messages: [], persist: async () => {} });
  const chats = new Map([[local.id, local], [blank.id, blank]]);

  const summaries = workspaceSummaries([], chats);

  expect(summaries).toHaveLength(1);
  expect(summaries[0]).toMatchObject({ id: 'local', title: 'Unsaved question', turns: 1 });
});

it('preserves saved flags, title and lineage without duplicating local chats', () => {
  const local = createWorkspaceChat({ id: 'same', messages: [], persist: async () => {} });
  const saved: SessionSummary = {
    id: 'same', title: 'Saved title', updatedAt: 10, turns: 1,
    pinned: true, archived: true, parentId: 'parent',
  };

  expect(workspaceSummaries([saved], new Map([[local.id, local]]))).toEqual([saved]);
});

it('does not resurrect deleted chats from local memory', async () => {
  const local = createWorkspaceChat({ id: 'deleted', messages: [
    { id: 'user', role: 'user', parts: [{ type: 'text', text: 'Deleted question' }] },
  ], persist: async () => {} });
  await local.dispose();

  expect(workspaceSummaries([], new Map([[local.id, local]]))).toEqual([]);
});
