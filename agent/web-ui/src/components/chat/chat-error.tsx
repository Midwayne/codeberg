import { AlertTriangle } from 'lucide-react';

import { type ChatView } from './chat';

export type ChatErrorProps = { state: Parameters<typeof ChatView>[0] };

export function ChatError({ state }: ChatErrorProps) {
  return (
    state.error && (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1 break-words">
          <div className="font-medium">Something went wrong</div>
          <div className="text-xs opacity-80">{state.error.message}</div>
        </div>
        <button
          type="button"
          disabled={!state.ready}
          onClick={() => state.regenerate()}
          className="shrink-0 rounded-md border border-destructive/40 px-2 py-1 text-xs hover:bg-destructive/20"
        >
          Retry
        </button>
      </div>
    )
  );
}
