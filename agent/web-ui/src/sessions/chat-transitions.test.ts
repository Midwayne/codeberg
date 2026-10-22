import { beforeEach, expect, it, vi } from 'vitest';

import { useChatTransitions } from './use-chat-transitions';
import { useSessionMutations } from './use-session-mutations';
import { createWorkspaceChat, type WorkspaceChat } from './workspace-chat';
import type { UIMessageChunk } from 'ai';

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
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));

    return 1;
  }));
});

function fixture() {
  const chats = { current: new Map<string, WorkspaceChat>() };
  const transitionIntent = { current: 0 };
  const renderedViews = { current: new Set<WorkspaceChat>() };
  const setActive = vi.fn();
  const refresh = vi.fn(async () => {});
  const setLoad = vi.fn();
  const api = vi.fn<typeof fetch>();
  const createChat = vi.fn((id: string) => {
    const chat = createWorkspaceChat({ id, messages: [], persist: async () => {} });
    chats.current.set(id, chat);

    return chat;
  });
  const options = { chats, renderedViews, transitionIntent, setActive, setLoad, refresh, api, createChat, sessionId: 'active' };
  const actions = useChatTransitions(options);

  return { ...options, ...actions };
}

it.each(['preflight', 'streaming'])('sends follow-ups queued during resumed-stream %s', async (phase) => {
  const state = fixture();
  let stream!: ReadableStreamDefaultController<UIMessageChunk>;
  let resume!: () => void;
  const preflight = new Promise<void>((resolve) => { resume = resolve; });
  const send = vi.fn(async () => new ReadableStream<UIMessageChunk>({ start(controller) {
    controller.enqueue({ type: 'start', messageId: 'next' });
    controller.enqueue({ type: 'finish' });
    controller.close();
  } }));
  const workspace = createWorkspaceChat({ id: 'reopened', messages: [], persist: async () => {},
    transport: { sendMessages: send,
      reconnectToStream: async () => {
        await preflight;

        return new ReadableStream({ start(controller) {
          stream = controller;
          controller.enqueue({ type: 'start', messageId: 'resumed' });
        } });
      },
    },
  });
  state.createChat.mockImplementation(() => workspace);
  state.api.mockResolvedValueOnce(Response.json({ id: 'reopened', messages: [], serverRunId: 'run' }));

  if (phase === 'streaming') resume();
  await state.resume('reopened');
  if (phase === 'streaming') await expect.poll(() => workspace.chat.status).toBe('streaming');
  workspace.turns.submit({ text: 'Follow-up after reconnect' });
  expect(send).not.toHaveBeenCalled();
  resume();
  await expect.poll(() => workspace.chat.status).toBe('streaming');
  stream.enqueue({ type: 'finish' });
  stream.close();

  await expect.poll(() => send.mock.calls.length).toBe(1);
  await expect.poll(() => workspace.chat.status).toBe('ready');
  expect(workspace.turns.getSnapshot().items).toEqual([]);
});

it('shows feedback before rebuilding an evicted view without fetching its cached history again', async () => {
  const state = fixture();
  const evicted = state.createChat('evicted');

  const opening = state.resume(evicted.id);

  expect(state.setLoad).toHaveBeenLastCalledWith({ id: evicted.id, status: 'loading' });
  expect(state.setActive).not.toHaveBeenCalled();
  expect(state.api).not.toHaveBeenCalled();

  await opening;

  expect(state.setActive).toHaveBeenLastCalledWith(evicted);
  expect(state.setLoad).toHaveBeenLastCalledWith(undefined);
});

it('opens a retained view immediately without scheduling a skeleton or another frame', async () => {
  const state = fixture();
  const retained = state.createChat('retained');
  state.renderedViews.current.add(retained);

  const opening = state.resume(retained.id);

  expect(state.setActive).toHaveBeenCalledExactlyOnceWith(retained);
  expect(state.setLoad).toHaveBeenCalledExactlyOnceWith(undefined);
  expect(requestAnimationFrame).not.toHaveBeenCalled();

  await opening;
});

it('cancels an evicted view while the skeleton is painting without accepting its deferred activation', async () => {
  const state = fixture();
  const previous = state.createChat(state.sessionId);
  const evicted = state.createChat('evicted');
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));

  const opening = state.resume(evicted.id);
  expect(state.setLoad).toHaveBeenLastCalledWith({ id: evicted.id, status: 'loading' });

  state.cancelResume();
  while (frames.length) frames.shift()!(0);
  await opening;

  expect(state.setActive).toHaveBeenLastCalledWith(previous);
  expect(state.setActive).not.toHaveBeenCalledWith(evicted);
  expect(state.setLoad).toHaveBeenLastCalledWith(undefined);
});

it('shows loading feedback before a first-time chat request resolves', async () => {
  const state = fixture();
  let resolve!: (response: Response) => void;
  state.api.mockReturnValueOnce(new Promise((done) => { resolve = done; }));

  const loading = state.resume('first-open');

  expect(state.setLoad).toHaveBeenLastCalledWith({ id: 'first-open', status: 'loading' });
  expect(state.setActive).not.toHaveBeenCalled();

  resolve(Response.json({ id: 'first-open', messages: [] }));
  await loading;

  expect(state.setActive).toHaveBeenCalledWith(state.chats.current.get('first-open'));
  expect(state.setLoad).toHaveBeenLastCalledWith(undefined);
});

it('reports a first-load failure and permits a successful retry', async () => {
  const state = fixture();
  state.api.mockResolvedValueOnce(new Response('Unavailable', { status: 500 }));

  await state.resume('retry-me');

  expect(state.setActive).not.toHaveBeenCalled();
  expect(state.setLoad).toHaveBeenLastCalledWith({
    id: 'retry-me', status: 'error', message: 'Could not load chat (500). Try again.',
  });

  state.api.mockResolvedValueOnce(Response.json({ id: 'retry-me', messages: [] }));
  await state.resume('retry-me');

  expect(state.setActive).toHaveBeenCalledOnce();
  expect(state.setLoad).toHaveBeenLastCalledWith(undefined);
});

it('clears first-load feedback when returning to a cached chat and ignores the old response', async () => {
  const state = fixture();
  const cached = state.createChat('cached');
  let reject!: (reason: Error) => void;
  state.api.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));

  const loading = state.resume('slow');
  await state.resume(cached.id);
  expect(state.setLoad).toHaveBeenLastCalledWith(undefined);

  reject(new TypeError('Failed to fetch'));
  await loading;

  expect(state.setActive).toHaveBeenCalledExactlyOnceWith(cached);
  expect(state.setLoad).toHaveBeenLastCalledWith(undefined);
});

it('cancels a first load without leaving a loading state or accepting its late response', async () => {
  const state = fixture();
  let resolve!: (response: Response) => void;
  state.api.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const loading = state.resume('cancelled');

  state.cancelResume();
  resolve(Response.json({ id: 'cancelled', messages: [] }));
  await loading;

  expect(state.setActive).not.toHaveBeenCalled();
  expect(state.setLoad).toHaveBeenLastCalledWith(undefined);
});

it('supersedes an already queued activation with the last committed chat when cancelled', async () => {
  const state = fixture();
  const previous = state.createChat(state.sessionId);
  state.api.mockResolvedValueOnce(Response.json({ id: 'queued', messages: [] }));

  await state.resume('queued');

  expect(state.setActive).toHaveBeenLastCalledWith(state.chats.current.get('queued'));

  state.cancelResume();

  expect(state.setActive).toHaveBeenLastCalledWith(previous);
  expect(state.setLoad).toHaveBeenLastCalledWith(undefined);
});

it('supersedes a queued activation when another uncached chat starts loading', async () => {
  const state = fixture();
  const previous = state.createChat(state.sessionId);
  let resolve!: (response: Response) => void;
  state.api.mockResolvedValueOnce(Response.json({ id: 'first', messages: [] }));
  state.api.mockReturnValueOnce(new Promise((done) => { resolve = done; }));

  await state.resume('first');
  state.setActive.mockClear();
  const second = state.resume('second');

  expect(state.setActive).toHaveBeenCalledExactlyOnceWith(previous);
  expect(state.setLoad).toHaveBeenLastCalledWith({ id: 'second', status: 'loading' });

  state.cancelResume();
  resolve(Response.json({ id: 'second', messages: [] }));
  await second;

  expect(state.setActive).toHaveBeenLastCalledWith(previous);
  expect(state.chats.current.has('second')).toBe(false);
});

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

it('reports a missing chat and refreshes the sidebar instead of silently ignoring the click', async () => {
  const state = fixture();
  state.api.mockResolvedValueOnce(new Response(null, { status: 404 }));

  await state.resume('missing');

  expect(state.setLoad).toHaveBeenLastCalledWith({
    id: 'missing', status: 'error', message: 'This chat no longer exists.',
  });
  expect(state.refresh).toHaveBeenCalledOnce();
  expect(state.setActive).not.toHaveBeenCalled();
});

it('reports a network failure and clears it when starting a new chat', async () => {
  const state = fixture();
  state.api.mockRejectedValueOnce(new TypeError('Failed to fetch'));

  await state.resume('offline');

  expect(state.setLoad).toHaveBeenLastCalledWith({
    id: 'offline', status: 'error', message: 'Could not load chat. Check your connection and try again.',
  });

  state.startNew();

  expect(state.setLoad).toHaveBeenLastCalledWith(undefined);
  expect(state.setActive).toHaveBeenCalledOnce();
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
