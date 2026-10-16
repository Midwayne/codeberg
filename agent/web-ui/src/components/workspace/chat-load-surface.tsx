import type { ChatLoad } from '../../sessions/chat-resume';
import { LoadingStatus } from '../loading';
import { LoadingSkeleton } from '../loading-skeleton';

type ChatLoadSurfaceProps = {
  load: ChatLoad;
  title: string;
  onRetry: () => void;
  onCancel: () => void;
};

export function ChatLoadSurface({ load, title, onRetry, onCancel }: ChatLoadSurfaceProps) {
  const loading = load.status === 'loading';

  return (
    <section aria-label="Open chat" aria-busy={loading} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:px-8">
        <h1 className="text-lg font-semibold break-words">{title}</h1>
        {loading ? (
          <>
            <LoadingStatus label="Loading chat…" />
            <LoadingSkeleton kind="section" />
          </>
        ) : (
          <p role="alert" className="text-sm break-words text-destructive">{load.message}</p>
        )}
        <div className="flex flex-wrap gap-3">
          {!loading && (
            <button type="button" onClick={onRetry}
              className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">
              Retry
            </button>
          )}
          <button type="button" onClick={onCancel}
            className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">
            {loading ? 'Cancel' : 'Back to previous chat'}
          </button>
        </div>
      </div>
    </section>
  );
}
