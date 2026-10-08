import type { UIMessage } from 'ai';
import { PenTool } from 'lucide-react';

import { canvasUrl } from './api';
import { canvasAnchor } from './conversation';
import { useCanvasSettings } from './use-settings';
import { useProjectApi } from '../lib/project-api';

export function ChatCanvasActions({ messages, sessionId }: { messages: UIMessage[]; sessionId: string }) {
  if (!sessionId || !canvasAnchor(messages)) return null;

  return <CanvasAction sessionId={sessionId} />;
}

function CanvasAction({ sessionId }: { sessionId: string }) {
  const { project } = useProjectApi();
  const { enabled } = useCanvasSettings();

  if (enabled === false) return null;

  const url = canvasUrl(sessionId, project?.id);

  return (
    <nav aria-label="Chat actions" className="absolute right-3 top-3 z-10 sm:right-14">
      <a href={url} target="_blank" rel="noreferrer"
        aria-label="Open canvas in a new window" title="Open canvas in a new window"
        onClick={(event) => {
          event.currentTarget.href = url + (event.detail === 0 ? '&motion=none' : '');
        }}
        className="inline-flex size-11 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <PenTool aria-hidden="true" className="size-4" />
      </a>
    </nav>
  );
}
