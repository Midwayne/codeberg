import { Suspense, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { ProjectChats } from '@/sessions/project-chat-registry';
import { createWorkspaceChat, type WorkspaceChat } from '@/sessions/workspace-chat';
import { useChatRegistry } from '@/sessions/use-chat-registry';
import { useChatTransitions } from '@/sessions/use-chat-transitions';
import type { ChatLoad } from '@/sessions/chat-resume';
import { ChatLoadSurface } from '@/components/workspace/chat-load-surface';
import '@/index.css';
import '@/loading.css';
import '@/motion.css';

const registry = new ProjectChats();
for (const id of ['previous', 'other']) {
  registry.chats.set(id, createWorkspaceChat({ id, messages: [], persist: async () => {} }));
}
if (new URL(location.href).searchParams.get('cached') === '1') {
  registry.chats.set('next', createWorkspaceChat({ id: 'next', messages: [], persist: async () => {} }));
}
registry.active = registry.chats.get('previous');
document.body.dataset.historyRequests = '0';

let release!: () => void;
let released = false;
const renderGate = new Promise<void>((resolve) => { release = resolve; });
let finishSecond!: () => void;
const secondResponse = new Promise<Response>((resolve) => {
  finishSecond = () => resolve(Response.json({ id: 'second', title: 'Second chat', messages: [] }));
});
const api: typeof fetch = async (input) => {
  document.body.dataset.historyRequests = String(Number(document.body.dataset.historyRequests) + 1);
  if (String(input).endsWith('/second')) return secondResponse;

  return Response.json({ id: 'next', title: 'Next chat', messages: [] });
};
const refresh = async () => {};

function CancellationCase() {
  const chats = useRef(registry.chats);
  const transitionIntent = useRef(0);
  const renderedViews = useRef<ReadonlySet<WorkspaceChat>>(new Set());
  const refreshRef = useRef(refresh);
  const seededRailPreview = useRef(false);
  const [load, setLoad] = useState<ChatLoad>();
  const { active, sessionId, setActive, createChat } = useChatRegistry({
    api, registry, refreshRef, chats, seededRailPreview,
  });
  const { resume, cancelResume } = useChatTransitions({
    transitionIntent, chats, renderedViews, setActive, setLoad, api, refresh, createChat, sessionId,
  });

  useLayoutEffect(() => {
    document.body.dataset.committedChat = active.id;
    document.body.dataset.registryChat = registry.active?.id;
  }, [active]);

  if (active.id === 'next' && !released) {
    // Deliberately pause the real transition after its activation was queued.
    document.body.dataset.activationRender = 'started';
    throw renderGate;
  }

  return <section className="space-y-4 p-6">
    <output aria-label="Active chat">{active.id}</output>
    <button className="ml-4 rounded border p-3" onClick={() => void resume('next')}>Open next chat</button>
    <button className="ml-4 rounded border p-3" onClick={() => void resume('second')}>Open second chat</button>
    {load && <ChatLoadSurface load={load} title={load.id} onCancel={cancelResume} onRetry={() => void resume(load.id)} />}
  </section>;
}

function Harness() {
  return <main className="bg-background text-foreground">
    <h1 className="px-6 pt-6 text-lg font-semibold">Queued chat activation · deterministic regression</h1>
    <button className="m-6 rounded border p-3" onClick={() => {
      released = true;
      release();
    }}>Finish queued render</button>
    <button className="m-6 rounded border p-3" onClick={finishSecond}>Finish second request</button>
    <Suspense fallback={<p role="status">Waiting for test render…</p>}>
      <CancellationCase />
    </Suspense>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
