import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Dialog } from '@/components/dialog';
import { Message } from '@/components/chat/message';
import { applyTheme } from '@/lib/themes';
import { trackMotionInput } from '@/lib/motion-input';
import '@/index.css';
import '@/motion.css';

applyTheme('dark');
trackMotionInput();

const url = `${location.origin}/bench/dialogs.html?confirmed=true&path=${'long-path/'.repeat(18)}`;

function DialogFixture() {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex flex-wrap gap-4 border-b p-4 text-sm">
        <span>Dialog regression · simulated conversation</span>
        <button onClick={() => applyTheme('dark')}>Dark</button>
        <button onClick={() => applyTheme('light')}>Light</button>
        <button onClick={() => setOpen(true)}>Shared dialog</button>
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto mt-24 max-w-2xl space-y-6">
          <Message learningEnabled={false} message={{ id: 'reply', role: 'assistant',
            parts: [{ type: 'text', text: `Open [the page directly](${url}).\n\nReview the destination before continuing.` }] }} />
          <textarea aria-label="Background input" className="w-full rounded-lg border bg-card p-3" />
          <section style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 100px' }}>
            {open && <Dialog label="Shared dialog" onClose={() => setOpen(false)} className="m-auto w-md">
              <div className="space-y-4 p-6">
                <h2>Shared native dialog</h2>
                <button onClick={() => setOpen(false)}>Close shared dialog</button>
              </div>
            </Dialog>}
          </section>
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<DialogFixture />);
