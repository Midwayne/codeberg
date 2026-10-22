import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { UIMessage } from 'ai';
import { Chat, type ChatProps } from '@/components/chat/chat';
import { ProjectApiContext } from '@/lib/project-api';
import '@/index.css';
import '@/loading.css';

const initial: UIMessage[] = [{ id: 'question', role: 'user', parts: [{ type: 'text', text: 'Explain the source.' }] }];
const paragraph = 'A source finding with enough content to exercise the scrolling transcript.\n\n';

function ScrollingFixture() {
  const [messages, setMessages] = useState(initial);
  const [status, setStatus] = useState<ChatProps['chat']['status']>('ready');
  const chat = { messages, status } as ChatProps['chat'];

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex shrink-0 gap-4 p-3">
        <button onClick={() => {
          setStatus('streaming');
          setMessages((current) => [...current, {
            id: `answer-${current.length}`, role: 'assistant',
            parts: [{ type: 'text', text: paragraph.repeat(35) }],
          }]);
        }}>Stream response</button>
        <button onClick={() => setStatus('ready')}>Complete response</button>
      </header>
      <ProjectApiContext.Provider value={{ project: { id: 'scroll-test', name: 'Scroll test', roots: [] },
        fetch: async () => Response.json([]), ready: true }}>
        <Chat chat={chat} sessionId="scroll-test" learningEnabled={false} chatInputs={['text']} />
      </ProjectApiContext.Provider>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<ScrollingFixture />);
