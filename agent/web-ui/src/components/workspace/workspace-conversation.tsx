import { ChatViews } from './chat-views';
import { ChatLoadSurface } from './chat-load-surface';
import type { WorkspaceViewProps } from './workspace';

type WorkspaceConversationProps = Pick<WorkspaceViewProps,
  'active' | 'renderedViews' | 'load' | 'sessions' | 'resume' | 'cancelResume' | 'learningEnabled' | 'chatInputs' | 'branchFrom' | 'jump' | 'sessionId'>;

export function WorkspaceConversation(state: WorkspaceConversationProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ChatViews
        active={state.active}
        renderedViews={state.renderedViews}
        hidden={Boolean(state.load)}
        learningEnabled={state.learningEnabled}
        chatInputs={state.chatInputs}
        onBranch={(index) => void state.branchFrom(index)}
        jump={state.jump?.sessionId === state.sessionId ? state.jump : undefined}
      />
      {state.load && (
        <ChatLoadSurface
          load={state.load}
          title={state.sessions.find((session) => session.id === state.load!.id)?.title ?? 'Chat'}
          onRetry={() => void state.resume(state.load!.id)}
          onCancel={state.cancelResume}
        />
      )}
    </div>
  );
}
