import type { UIMessage } from 'ai';
import { expect, it, vi } from 'vitest';

import { useChatBranch } from './use-chat-branch';
import { createWorkspaceChat, type WorkspaceChat, type WorkspaceChatSave } from './workspace-chat';

// Exercise the callback without mounting the visual workspace.
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useCallback: (callback: unknown) => callback,
}));

const transcript: UIMessage[] = [
  { id: 'question', role: 'user', parts: [{ type: 'text', text: 'How does auth work?' }] },
  { id: 'answer', role: 'assistant', parts: [{ type: 'text', text: 'Through the session middleware.' }] },
];

function fixture(persist: (record: WorkspaceChatSave) => Promise<void>) {
  const saved: WorkspaceChatSave[] = [];
  const record = async (next: WorkspaceChatSave) => {
    await persist(next);
    saved.push(next);
  };

  const createChat = vi.fn((id: string, messages: UIMessage[], parentId?: string, title?: string) =>
    createWorkspaceChat({ id, messages, parentId, title, persist: record }));
  const active = createChat('parent', transcript, undefined, 'Auth walkthrough');

  const setActive = vi.fn();
  const refresh = vi.fn(async () => {});
  const setSessionError = vi.fn();
  const transitionIntent = { current: 0 };
  const { branchFrom } = useChatBranch({
    transitionIntent, active, api: vi.fn<typeof fetch>(), refresh, setActive, createChat, setSessionError,
  });

  return { branchFrom, saved, setActive, refresh, setSessionError, transitionIntent };
}

it('moves to the branch before either chat has finished saving', async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const state = fixture(() => blocked);

  const branching = state.branchFrom(1);

  expect(state.setActive).toHaveBeenCalledTimes(1);
  const branch = state.setActive.mock.calls[0]![0] as WorkspaceChat;

  expect(branch.parentId).toBe('parent');
  expect(branch.title).toBe('How does auth work? (branch)');
  expect(branch.chat.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  expect(branch.branch).toEqual({ parentTitle: 'Auth walkthrough', messageCount: 2 });
  expect(state.transitionIntent.current).toBe(1);
  expect(state.saved).toEqual([]);

  release();
  await branching;

  // The parent is written first so the branch's lineage target exists.
  expect(state.saved.map((record) => record.id)).toEqual(['parent', branch.id]);
  expect(state.saved[1]!.parentId).toBe('parent');
  expect(state.refresh).toHaveBeenCalled();
  expect(state.setSessionError).toHaveBeenLastCalledWith('');
});

it('keeps the branch open and reports the failure when saving fails', async () => {
  const state = fixture(async () => {
    throw new Error('Could not save chat (500)');
  });

  await state.branchFrom(1);

  expect(state.setActive).toHaveBeenCalledTimes(1);
  expect(state.setSessionError).toHaveBeenLastCalledWith('Could not save chat (500)');
  expect(state.refresh).toHaveBeenCalled();
});

it('does not branch while a response is still streaming', async () => {
  const state = fixture(async () => {});
  const busy = createWorkspaceChat({ id: 'busy', messages: transcript, persist: async () => {} });
  const streaming = { ...busy, chat: { status: 'streaming', messages: transcript } } as unknown as WorkspaceChat;
  const { branchFrom } = useChatBranch({
    transitionIntent: state.transitionIntent, active: streaming,
    api: vi.fn<typeof fetch>(), refresh: state.refresh, setActive: state.setActive, createChat: vi.fn(), setSessionError: state.setSessionError,
  });

  await branchFrom(1);

  expect(state.setActive).not.toHaveBeenCalled();
});
