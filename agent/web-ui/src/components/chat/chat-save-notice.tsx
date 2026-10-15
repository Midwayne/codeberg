import { useSyncExternalStore } from 'react';

import type { ChatSaveState } from '../../sessions/chat-save-state';

export function ChatSaveNotice({ state }: { state: ChatSaveState }) {
  const { error, retrying } = useSyncExternalStore(state.subscribe, state.getSnapshot, state.getSnapshot);
  if (!error) return null;

  return (
    <div role="alert" className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-3 px-4 py-3 text-sm sm:px-8">
      <div className="min-w-0 flex-1 break-words">
        <p className="font-medium text-destructive">Chat changes aren’t saved yet. Keep this tab open.</p>
        <p className="mt-1 text-xs text-muted-foreground">{error}</p>
      </div>
      <button type="button" disabled={retrying} onClick={() => void state.retry()}
        className="min-h-11 shrink-0 rounded-lg border border-border px-3 font-medium hover:bg-accent disabled:opacity-50">
        {retrying ? 'Saving…' : 'Retry save'}
      </button>
    </div>
  );
}
