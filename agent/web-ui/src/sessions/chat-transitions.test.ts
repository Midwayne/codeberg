import { beforeEach, expect, it, vi } from 'vitest';

import { useChatTransitions } from './use-chat-transitions';
import { useSessionMutations } from './use-session-mutations';
import { createWorkspaceChat, type WorkspaceChat } from './workspace-chat';

const { cleanups } = vi.hoisted(() => ({ cleanups: [] as (() => void)[] }));

// Exercise the callbacks and their cleanup without mounting the visual workspace.
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  },
}));

beforeEach(() => {
  cleanups.length = 0;
  vi.stubGlobal('window', new EventTarget());
});

function fixture() {
  const chats = { current: new Map<string, WorkspaceChat>() };
  const transitionIntent = { current: 0 };
  const setActive = vi.fn();
  const refresh = vi.fn(async () => {});
  const api = vi.fn<typeof fetch>();
  const createChat = vi.fn((id: string) => {
    const chat = createWorkspaceChat({ id, messages: [], persist: async () => {} });
    chats.current.set(id, chat);

    return chat;
  });
  const options = { chats, transitionIntent, setActive, refresh, api, createChat, sessionId: 'active' };
  const actions = useChatTransitions(options);

  return { ...options, ...actions };
}

it('ignores an older load when another chat or a new draft is selected', async () => {
  const state = fixture();
  let resolve!: (response: Response) => void;
  state.api.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const loading = state.resume('slow');
  state.startNew();
  const selected = state.setActive.mock.calls[0]![0];

  resolve(Response.json({ id: 'slow', messages: [] }));
  await loading;

  expect(state.setActive).toHaveBeenCalledOnce();
  expect(state.setActive).toHaveBeenCalledWith(selected);
  expect(state.chats.current.has('slow')).toBe(false);
});

it('ignores a delayed load after the project workspace unmounts', async () => {
  const state = fixture();
  let resolve!: (response: Response) => void;
  state.api.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const loading = state.resume('slow');
  cleanups.forEach((cleanup) => cleanup());

  resolve(Response.json({ id: 'slow', messages: [] }));
  await loading;

  expect(state.setActive).not.toHaveBeenCalled();
  expect(state.chats.current.has('slow')).toBe(false);
});

it('does not reload a chat while its save is settling for deletion', async () => {
  const state = fixture();
  let finishSave!: () => void;
  const chat = createWorkspaceChat({ id: 'removing', messages: [],
    persist: () => new Promise((resolve) => { finishSave = resolve; }) });
  state.chats.current.set(chat.id, chat);
  const sending = chat.chat.sendMessage({ text: 'Question' });
  await expect.poll(() => typeof finishSave).toBe('function');
  state.api.mockImplementation(async (_input, init) => init?.method === 'DELETE'
    ? new Response(null, { status: 204 }) : Response.json({ id: chat.id, messages: [] }));
  const mutations = useSessionMutations({ ...state, setSessionError: vi.fn() });

  const removing = mutations.remove(chat.id);
  await state.resume(chat.id);

  expect(state.setActive).not.toHaveBeenCalled();
  expect(state.api).not.toHaveBeenCalled();

  finishSave();
  await removing;
  await sending;
  expect(state.chats.current.has(chat.id)).toBe(false);
  expect(state.api).toHaveBeenCalledOnce();
});

it('ignores a loaded record deleted by storage cleanup while the load was pending', async () => {
  const state = fixture();
  let resolve!: (response: Response) => void;
  state.api.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const loading = state.resume('cleaned');
  window.dispatchEvent(Object.assign(new Event('codeberg:storage-cleaned'), {
    detail: { deletedChatIds: ['cleaned'] },
  }));

  resolve(Response.json({ id: 'cleaned', messages: [] }));
  await loading;

  expect(state.setActive).not.toHaveBeenCalled();
  expect(state.chats.current.has('cleaned')).toBe(false);
});

it('reports a failed deletion and permits reloading the retained server chat', async () => {
  const state = fixture();
  const chat = state.createChat('retained');
  const setSessionError = vi.fn();
  state.api.mockResolvedValueOnce(new Response('Storage unavailable', { status: 500 }));
  const mutations = useSessionMutations({ ...state, setSessionError });

  await mutations.remove(chat.id);

  expect(setSessionError).toHaveBeenCalledWith('Could not delete chat (500)');
  expect(state.chats.current.has(chat.id)).toBe(false);
  expect(state.refresh).toHaveBeenCalledOnce();

  state.api.mockResolvedValueOnce(Response.json({ id: chat.id, messages: [] }));
  await state.resume(chat.id);
  expect(state.setActive).toHaveBeenCalledOnce();
  expect(state.chats.current.get(chat.id)?.disposed).toBe(false);
});
