import type { UseChatHelpers } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Chat } from '@/components/chat/chat';
import '@/index.css';

// Production React; synthetic history and no LLM calls. Access counting proves
// that edits do not revisit transcript content, independently of noisy timings.
let transcriptReads = 0;
const messages: UIMessage[] = Array.from({ length: 200 }, (_, index) => {
  const parts: UIMessage['parts'] = [{ type: 'text', text: index % 2
    ? `## Finding ${index}\n\nThe request passes through **the daemon** before returning search results.\n\n- Parse the request\n- Find matching source chunks\n- Return citations\n\nUse the result to inspect the surrounding implementation.`
    : `How does request ${index} reach the search implementation?` }];
  return { id: `bench-${index}`, role: index % 2 ? 'assistant' : 'user', get parts() { transcriptReads++; return parts; } };
});
const helpers = {
  messages, status: 'ready', error: undefined,
  sendMessage: async () => {}, stop: async () => {}, regenerate: async () => {},
} as unknown as UseChatHelpers<UIMessage>;
const inputs = ['text'] as const;

function Benchmark() {
  const root = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState('Warm up the markdown renderer, then run five trials. Timings measure synchronous React draft commits in production, not network or device-wide INP.');
  const [running, setRunning] = useState(false);
  async function run() {
    const textarea = root.current?.querySelector('textarea');
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!textarea || !setValue) throw new Error('Missing composer');
    setRunning(true);
    const trials: number[] = [];
    const reads: number[] = [];
    for (let trial = 0; trial < 5; trial++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      transcriptReads = 0;
      const start = performance.now();
      for (let edit = 0; edit < 25; edit++) {
        flushSync(() => {
          setValue.call(textarea, `Draft ${trial}: ${'x'.repeat(edit + 1)}`);
          textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'x' }));
        });
      }
      trials.push((performance.now() - start) / 25);
      reads.push(transcriptReads);
    }
    const median = [...trials].sort((a, b) => a - b)[2]!;
    setResult(JSON.stringify({ messages: messages.length, editsPerTrial: 25, trialsMsPerEdit: trials, medianMsPerEdit: median, transcriptReads: reads, draftIsolation: reads.every((count) => count === 0) ? 'PASS' : 'FAIL', draft: textarea.value }, null, 2));
    setRunning(false);
  }
  return <div className="flex h-dvh flex-col bg-background text-foreground">
    <header className="border-b border-border p-3"><h1 className="text-lg font-semibold">Typing benchmark · synthetic history</h1><button type="button" disabled={running} onClick={() => void run()} className="mt-2 rounded-lg bg-primary px-4 py-2 text-primary-foreground">Run five trials</button><pre aria-label="Benchmark results" className="mt-2 max-h-48 overflow-auto text-xs">{result}</pre></header>
    <div ref={root} className="flex min-h-0 flex-1 flex-col"><Chat chat={helpers} sessionId="benchmark" learningEnabled={false} chatInputs={[...inputs]} /></div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Benchmark />);
