import { LoadingBoundary } from '../components/loading';
import { Toggle } from '../components/learning-controls';
import { useCanvasSettings } from './use-settings';

export function CanvasSettings() {
  const state = useCanvasSettings();

  return (
    <section className="space-y-6" aria-labelledby="canvas-settings-heading">
      <div className="space-y-2">
        <h2 id="canvas-settings-heading" className="text-lg font-semibold">Canvas</h2>
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">
          Sketch architecture and flows with your agent on a shared local Excalidraw canvas.
          Each chat gets one canvas automatically when the agent draws. Expand the drawing to edit alongside your agent.
        </p>
      </div>
      {state.error && <div role="alert" className="text-sm">{state.error}{' '}
        <button className="underline underline-offset-4" onClick={() => void state.refresh()}>Retry</button>
      </div>}
      <LoadingBoundary loading={state.enabled === undefined && !state.error} label="Loading canvas settings…" kind="control">
        {state.enabled !== undefined && (
          <Toggle label="Enable local canvas" description="Make canvas tools available to the agent on new chat turns. Existing drawings are kept when disabled."
            checked={state.enabled} disabled={state.busy} onChange={(enabled) => void state.change(enabled)} />
        )}
      </LoadingBoundary>
      <p className="max-w-prose text-sm leading-6 text-muted-foreground">
        The canvas and fonts run locally, without cloud storage. Canvas tools share diagram content with your configured agent model.
      </p>
      <p role="status" className="text-xs text-muted-foreground">{state.busy ? 'Saving…' : 'Changes save automatically for this project.'}</p>
    </section>
  );
}
