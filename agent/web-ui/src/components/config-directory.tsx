import { buttonClass } from './settings-styles';

import { FolderOpen } from 'lucide-react';
import { useState } from 'react';

export function OpenConfigDirectory() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ path?: string; error?: string }>();
  return (
    <div className="w-full space-y-2 sm:w-auto sm:max-w-sm">
      <OpenDirectoryButton busy={busy} setBusy={setBusy} setResult={setResult} />
      {result && (
        <div role={result.error ? 'alert' : 'status'} className="break-words text-xs leading-5 sm:text-right">
          {result.error && <p className="text-destructive">{result.error}</p>}
          {result.path && (
            <p className="text-muted-foreground">
              Config directory: <span className="break-all">{result.path}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export type OpenDirectoryButtonProps = {
  busy: boolean;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setResult: React.Dispatch<React.SetStateAction<{ path?: string; error?: string } | undefined>>;
};

export function OpenDirectoryButton({ busy, setBusy, setResult }: OpenDirectoryButtonProps) {
  return (
    <button
      type="button"
      disabled={busy}
      className={`${buttonClass} flex w-full items-center justify-center gap-2 sm:w-auto sm:ml-auto`}
      onClick={() => {
        if (busy) return;
        setBusy(true);
        setResult(undefined);
        void fetch('/api/config/open-directory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
          .then(async (response) => {
            const text = await response.text();
            let value: { path?: string; message?: string };
            try {
              value = JSON.parse(text) as typeof value;
            } catch {
              throw new Error(text || 'Could not open the config directory.');
            }
            setResult({
              path: value.path,
              error: response.ok ? undefined : (value.message ?? 'Could not open the config directory.'),
            });
          })
          .catch((reason: unknown) => setResult({ error: reason instanceof Error ? reason.message : String(reason) }))
          .finally(() => setBusy(false));
      }}
    >
      <FolderOpen aria-hidden="true" className="size-4" />
      {busy ? 'Opening…' : 'Open config directory'}
    </button>
  );
}
