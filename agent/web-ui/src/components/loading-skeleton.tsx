import './loading-skeleton.css';

export type LoadingKind = 'workspace' | 'chat' | 'section' | 'form' | 'list' | 'chart' | 'detail' | 'canvas' | 'control';

export function LoadingSkeleton({ kind }: { kind: LoadingKind }) {
  if (kind === 'workspace') return <WorkspaceSkeleton />;
  if (kind === 'chat') return <ChatSkeleton />;

  return (
    <div aria-hidden="true" className={`ui-loading-scaffold ui-loading-${kind}`}>
      <span className="ui-loading-line" />
      <span className="ui-loading-block" />
      <span className="ui-loading-line" />
      <span className="ui-loading-block" />
      <span className="ui-loading-line" />
      <span className="ui-loading-line" />
    </div>
  );
}

/* Mirrors the transcript: a prompt bubble on the right, then an answer's lines on the left. */
function ChatSkeleton() {
  return (
    <div aria-hidden="true" className="ui-loading-chat">
      {[0, 1].map((turn) => (
        <div key={turn} className="ui-loading-turn">
          <span className="ui-loading-bubble" />
          <div className="ui-loading-answer">
            <span className="ui-loading-line" />
            <span className="ui-loading-line" />
            <span className="ui-loading-line" />
          </div>
        </div>
      ))}
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div aria-hidden="true" className="ui-loading-workspace">
      <div className="ui-loading-sidebar">
        <span className="ui-loading-block" />
        <span className="ui-loading-block" />
        <span className="ui-loading-block" />
      </div>
      <div className="ui-loading-conversation">
        <ChatSkeleton />
        <span className="ui-loading-composer" />
      </div>
    </div>
  );
}
