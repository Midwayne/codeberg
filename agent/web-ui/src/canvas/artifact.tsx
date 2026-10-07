import { useContext } from 'react';
import { Expand, PenTool } from 'lucide-react';
import { CanvasConversation } from './conversation';
import { canvasUrl } from './api';
import { useProjectApi } from '../lib/project-api';
import { useCanvasSettings } from './use-settings';
import type { ToolView } from '../components/chat/message';
import { ToolError } from '../components/chat/tool-status';
import './motion.css';

export function CanvasArtifact({ part }: { part: ToolView }) {
  const { chatId, anchor } = useContext(CanvasConversation);
  const output = part.output as { kind?: string; error?: string; code?: string; retryable?: boolean } | undefined;
  if (output?.code === 'CANVAS_REVISION_CONFLICT' && output.retryable === true) {
    return <p role="status" className="my-2 text-sm text-muted-foreground">Canvas changed before this edit could be saved.</p>;
  }
  if (output?.error) return <ToolError name="Canvas" message={output.error} />;

  if (!chatId || anchor !== part.toolCallId || output?.kind !== 'canvas') return null;

  return <CanvasCard chatId={chatId} />;
}

function CanvasCard({ chatId }: { chatId: string }) {
  const { project } = useProjectApi();
  const { enabled } = useCanvasSettings();
  const { editing } = useContext(CanvasConversation);

  return (
    <section aria-label="Canvas" className="my-3 overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-1.5">
        <span className="flex items-center gap-2 text-xs text-muted-foreground"><PenTool className="size-3.5" />Canvas</span>
        <span role="status" className="canvas-editing ml-auto text-xs text-muted-foreground" data-active={Boolean(editing && enabled !== false)}>
          <span className="canvas-editing-dot" aria-hidden="true" />{editing && enabled !== false ? 'Agent is editing…' : ''}
        </span>
        {enabled !== false && <a href={canvasUrl(chatId, project?.id)} target="_blank" rel="noreferrer"
          onClick={(event) => {
            event.currentTarget.href = canvasUrl(chatId, project?.id) + (event.detail === 0 ? '&motion=none' : '');
          }}
          aria-label="Expand canvas" className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
          <Expand className="size-4" />
        </a>}
      </div>
      {enabled === false ? <p className="p-6 text-sm text-muted-foreground">Canvas is disabled. Enable it in Settings to view this drawing.</p> :
        <iframe title="Chat canvas" src={canvasUrl(chatId, project?.id, true)} className="h-[min(40dvh,24rem)] min-h-64 w-full border-0" />}
    </section>
  );
}
