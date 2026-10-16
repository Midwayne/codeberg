import type { UIMessage } from 'ai';
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Workspace } from '@/components/workspace/workspace';
import { ProjectApiContext } from '@/lib/project-api';
import { ProjectChatsContext } from '@/sessions/project-chats';
import { ProjectChatRegistry } from '@/sessions/project-chat-registry';
import { createWorkspaceChat } from '@/sessions/workspace-chat';
import { switchingScenario } from './switching-scenarios';
import '@/index.css';
import '@/loading.css';
import '@/motion.css';

let transcriptReads = 0;
let historyRequests = 0;
const scenario = switchingScenario();
const registry = new ProjectChatRegistry();
const project = { id: 'benchmark', name: 'Synthetic project', roots: [] };
const chats = registry.forProject(project.id);
const summaries = Array.from({ length: 5 }, (_, chatIndex) => {
  const id = `switch-${chatIndex}`;
  const messages: UIMessage[] = Array.from({ length: 200 }, (_, index) => {
    const parts: UIMessage['parts'] = [{ type: 'text', text: index % 2
      ? `## Finding ${index}\n\nThe request passes through **the daemon** before returning search results.\n\n- Parse the request\n- Find matching source chunks\n- Return citations\n\nUse the result to inspect the surrounding implementation.`
      : `Chat ${chatIndex}: how does request ${index} reach search?` }];

    return { id: `${id}-${index}`, role: index % 2 ? 'assistant' : 'user',
      get parts() { transcriptReads++; return parts; } };
  });
  const chat = createWorkspaceChat({ id, title: `Synthetic chat ${chatIndex}`, messages, persist: async () => {} });
  chats.chats.set(id, chat);
  chats.active ??= chat;

  return { id, title: chat.title!, updatedAt: 5 - chatIndex, turns: 100,
    pinned: scenario.pinned.includes(chatIndex), archived: false };
});
const coldMessages = chats.chats.get('switch-0')!.chat.messages.slice(0, 20);
let failedOnce = false;

for (const [id, title] of [['cold', 'Cold saved chat'], ['retry', 'Retry saved chat'], ['missing', 'Missing saved chat']] as const) {
  summaries.push({ id, title, updatedAt: 0, turns: 10,
    pinned: id === 'cold' && scenario.pinned.length > 0, archived: false });
}

const api: typeof fetch = async (input) => {
  const url = String(input);
  if (url === '/api/sessions') return Response.json(summaries);
  if (url === '/api/settings/canvas') return Response.json({ enabled: false });
  if (url.startsWith('/api/sessions/')) {
    historyRequests++;
    const id = url.split('/').at(-1)!;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (id === 'missing') return new Response(null, { status: 404 });
    if (id === 'retry' && !failedOnce) {
      failedOnce = true;

      return new Response(null, { status: 500 });
    }

    return Response.json({ id, title: summaries.find((item) => item.id === id)?.title, messages: coldMessages });
  }

  return Response.json([]);
};
const context = { project, fetch: api, ready: true };

// Browser regression input only: render real native attachment players.
window.addEventListener('benchmark:attach-media', (event) => {
  const files = (event as CustomEvent<UIMessage['parts']>).detail;
  const workspace = chats.chats.get('switch-0')!;
  workspace.chat.messages = workspace.chat.messages.map((message, index) => index === 0
    ? { ...message, parts: [...message.parts, ...files] } : message);
});

async function waitForChat(root: HTMLElement, id: string) {
  const deadline = performance.now() + 10_000;

  while (true) {
    const message = root.querySelector(`[data-message-id="${id}-0"]`);
    const loading = root.querySelector('[aria-label="Open chat"]');
    if (message?.getClientRects().length && !loading) return;
    if (performance.now() > deadline) throw new Error(`Chat did not become ready: ${id}`);

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

function Benchmark() {
  const root = useRef<HTMLDivElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [result, setResult] = useState('Warm both transcripts, then run five trials. Production React, synthetic cached chats, no network or LLM calls.');
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    const trials: number[] = [];
    const readyTrials: number[] = [];
    const reads: number[] = [];
    const requestsBefore = historyRequests;

    for (let trial = 0; trial < 5; trial++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      transcriptReads = 0;
      let synchronous = 0;
      let ready = 0;

      for (let step = 0; step < 20; step++) {
        const title = `Synthetic chat ${scenario.order[step % scenario.order.length]}`;
        const button = Array.from(root.current!.querySelectorAll('button')).find((item) => item.textContent?.includes(title));
        if (!button) throw new Error(`Missing ${title}`);

        const start = performance.now();
        flushSync(() => button.click());
        synchronous += performance.now() - start;
        await waitForChat(root.current!, `switch-${scenario.order[step % scenario.order.length]}`);
        ready += performance.now() - start;
      }
      trials.push(synchronous / 20);
      readyTrials.push(ready / 20);
      reads.push(transcriptReads);
    }
    setResult(JSON.stringify({ scenario: scenario.label, order: scenario.order,
      historyRequests: historyRequests - requestsBefore, messagesPerChat: 200, switchesPerTrial: 20, trialsMsPerSwitch: trials,
      medianMsPerSwitch: [...trials].sort((a, b) => a - b)[2],
      trialsMsUntilReady: readyTrials, medianMsUntilReady: [...readyTrials].sort((a, b) => a - b)[2], transcriptReads: reads }, null, 2));
    setRunning(false);
  }

  return <div className="flex h-dvh flex-col bg-background text-foreground">
    <header className="shrink-0 border-b border-border p-3">
      <h1 className="text-lg font-semibold">Chat switching · {scenario.label} · synthetic cached history</h1>
      <button disabled={running} onClick={() => void run()} className="rounded bg-primary px-3 py-2 text-primary-foreground">Run five trials</button>
      <button onClick={() => setSidebarOpen(true)} className="ml-3 underline">Show chats</button>
      <button onClick={() => {
        const chat = chats.chats.get('switch-0')!;
        chat.chat.messages = [...chat.chat.messages,
          { id: 'background-update', role: 'assistant', parts: [{ type: 'text', text: 'Background response arrived.' }] }];
      }} className="ml-3 underline">Update chat 0 in background</button>
      <button onClick={() => {
        const index = summaries.findIndex((item) => item.id === 'switch-0');
        if (index >= 0) summaries.splice(index, 1);

        window.dispatchEvent(new CustomEvent('codeberg:storage-cleaned', { detail: { deletedChatIds: ['switch-0'] } }));
      }} className="ml-3 underline">Clean up chat 0</button>
      <pre aria-label="Benchmark results" className="max-h-40 overflow-auto text-xs">{result}</pre>
    </header>
    <div ref={root} className="flex min-h-0 flex-1">
      <ProjectApiContext.Provider value={context}>
        <ProjectChatsContext.Provider value={registry}>
          <Workspace sidebarOpen={sidebarOpen} onSidebarClose={() => setSidebarOpen(false)} learningEnabled={false} chatInputs={['text']}
            searchOpen={false} onSearchClose={() => {}} />
        </ProjectChatsContext.Provider>
      </ProjectApiContext.Provider>
    </div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Benchmark />);
