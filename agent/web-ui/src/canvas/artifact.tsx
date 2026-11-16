import { useContext } from 'react';
import { ExternalLink, PenTool } from 'lucide-react';
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
  const active = Boolean(editing && enabled !== false);

  // No inline preview: each embedded editor booted a full Excalidraw document
  // on the chat's main thread, and retained chats kept several alive.
  return (
    <section aria-label="Canvas" className="my-3 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background px-4 py-2">
      <span className="flex items-center gap-2 text-sm text-muted-foreground"><PenTool className="size-4" />Canvas</span>

      <span role="status" className="canvas-editing text-xs text-muted-foreground" data-active={active}>
        <span className="canvas-editing-dot" aria-hidden="true" />{active ? 'Agent is editing…' : ''}
      </span>

      {enabled === false
        ? <p className="ml-auto text-sm text-muted-foreground">Canvas is disabled. Enable it in Settings to view this drawing.</p>
        : <OpenCanvasLink chatId={chatId} project={project?.id} />}
    </section>
  );
}

function OpenCanvasLink({ chatId, project }: { chatId: string; project?: string }) {
  return (
    <a href={canvasUrl(chatId, project)} target="_blank" rel="noreferrer"
      onClick={(event) => {
        // Keyboard activation (detail 0) opens without the entrance animation.
        event.currentTarget.href = canvasUrl(chatId, project) + (event.detail === 0 ? '&motion=none' : '');
      }}
      className="ml-auto flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
      <ExternalLink aria-hidden="true" className="size-4" />Open canvas
    </a>
  );
}
