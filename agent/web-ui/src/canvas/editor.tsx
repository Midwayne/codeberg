import { Excalidraw, MainMenu } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { useEditor } from './use-editor';
import { canvasEmbedded } from './api';
import './style.css';

export default function CanvasEditor() {
  const state = useEditor();
  const embedded = canvasEmbedded();

  return (
    <main className="flex h-dvh min-w-0 flex-col bg-background text-foreground">
      {!embedded && <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h1 className="text-sm font-medium">Canvas</h1>
        <p role="status" className="text-xs text-muted-foreground">{state.status}</p>
      </header>}
      {embedded && !state.scene && <p role="status" className="p-4 text-xs text-muted-foreground">{state.status}</p>}
      {state.conflict && (
        <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 text-sm">
          <span>Unsaved edits are kept in this tab.</span>
          <button className="rounded-md border border-border px-3 py-2 hover:bg-accent" onClick={() => downloadDraft(state)}>
            Download my edits
          </button>
          <button className="rounded-md border border-border px-3 py-2 hover:bg-accent" onClick={() => void state.sync.reload()}>
            Load saved canvas
          </button>
        </div>
      )}
      <div className={`local-canvas min-h-0 flex-1 ${embedded ? 'canvas-preview' : ''}`}>
        <Excalidraw viewModeEnabled={embedded} zenModeEnabled={embedded} excalidrawAPI={state.setApi} onChange={state.onChange}
          initialData={{ appState: { currentItemFontFamily: 5 } }}
          validateEmbeddable={() => false} onLinkOpen={(_element, event) => event.preventDefault()}
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false,
            export: { saveFileToDisk: true }, saveAsImage: true } }}>
          <MainMenu>
            {!embedded && <MainMenu.DefaultItems.Export />}
            {!embedded && <MainMenu.DefaultItems.SaveAsImage />}
          </MainMenu>
        </Excalidraw>
      </div>
    </main>
  );
}

function downloadDraft(state: ReturnType<typeof useEditor>): void {
  const scene = state.sync.local ?? state.scene;
  if (!scene) return;

  const url = URL.createObjectURL(new Blob([JSON.stringify(scene)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'canvas-local.excalidraw';
  link.click();
  URL.revokeObjectURL(url);
}
