export type LoadingKind = 'workspace' | 'section' | 'form' | 'list' | 'chart' | 'detail' | 'canvas' | 'control';

export function LoadingSkeleton({ kind }: { kind: LoadingKind }) {
  if (kind === 'workspace') return <WorkspaceSkeleton />;

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

function WorkspaceSkeleton() {
  return (
    <div aria-hidden="true" className="ui-loading-workspace">
      <div className="ui-loading-sidebar">
        <span className="ui-loading-block" />
        <span className="ui-loading-block" />
        <span className="ui-loading-block" />
      </div>
      <div className="ui-loading-conversation">
        <div className="ui-loading-scaffold">
          <span className="ui-loading-line" />
          <span className="ui-loading-line" />
          <span className="ui-loading-line" />
        </div>
        <span className="ui-loading-composer" />
      </div>
    </div>
  );
}
