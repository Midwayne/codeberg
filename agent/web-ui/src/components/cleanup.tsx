import { CleanupConfirmation, CleanupSelection } from './cleanup-confirmation';

import { useProjectApi } from '../lib/project-api';

import { useEffect, useState } from 'react';
import { previewCleanup, type CleanupCategory, type CleanupPreview } from '../lib/resources';
import { ErrorNotice } from './ui';
import { type CleanupPreviewErrorProps } from './settings';
import { createCleanupAction } from './cleanup-action';

export function CleanupPanel() {
  const state = useCleanupPanel();

  return <CleanupPanelView {...state} />;
}

export function useCleanupPanel() {
  const { fetch: api } = useProjectApi();
  const [days, setDays] = useState(30);
  const [selected, setSelected] = useState<CleanupCategory[]>([]);
  const [preview, setPreview] = useState<CleanupPreview>();
  const [previewError, setPreviewError] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useCleanupPreview({ setPreview, setPreviewError, days, api, revision });

  const count =
    preview?.categories.filter((row) => selected.includes(row.category)).reduce((sum, row) => sum + row.count, 0) ?? 0;
  const { remove } = createCleanupAction({
    setBusy,
    setError,
    setResult,
    selected,
    days,
    api,
    setConfirming,
    setSelected,
    setRevision,
  });

  return {
    previewError,
    setRevision,
    preview,
    days,
    setDays,
    setConfirming,
    setResult,
    setError,
    selected,
    setSelected,
    busy,
    confirming,
    count,
    remove,
    error,
    result,
  };
}

export type CleanupPanelViewProps = ReturnType<typeof useCleanupPanel>;

export function CleanupPanelView(state: CleanupPanelViewProps) {
  return (
    <section className="space-y-5" aria-label="Free up resources">
      <div>
        <h2 className="text-lg font-semibold">Free up resources</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose what to remove and how old it should be. Cleanup permanently deletes matching files.
        </p>
      </div>
      <CleanupPreviewError state={state} />
      <CleanupSelection
        preview={state.preview}
        previewError={state.previewError}
        days={state.days}
        setDays={state.setDays}
        setConfirming={state.setConfirming}
        setResult={state.setResult}
        setError={state.setError}
        selected={state.selected}
        setSelected={state.setSelected}
        busy={state.busy}
      />
      <p className="text-xs text-muted-foreground">
        Interaction/feedback source records and job receipts are kept to preserve provenance and prevent automatic
        regeneration on restart. New feedback or code changes may generate new training or knowledge data.
      </p>
      <CleanupConfirmation
        confirming={state.confirming}
        count={state.count}
        selected={state.selected}
        busy={state.busy}
        remove={state.remove}
        setConfirming={state.setConfirming}
      />
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.result && (
        <p role="status" className="text-sm">
          {state.result}
        </p>
      )}
    </section>
  );
}

export type CleanupConfirmationProps = Pick<
  Parameters<typeof CleanupPanelView>[0],
  'confirming' | 'count' | 'selected' | 'busy' | 'remove' | 'setConfirming'
>;

export type CleanupSelectionProps = Pick<
  Parameters<typeof CleanupPanelView>[0],
  | 'preview'
  | 'previewError'
  | 'days'
  | 'setDays'
  | 'setConfirming'
  | 'setResult'
  | 'setError'
  | 'selected'
  | 'setSelected'
  | 'busy'
>;

export function CleanupPreviewError({ state }: CleanupPreviewErrorProps) {
  return (
    state.previewError && (
      <ErrorNotice
        title="Could not calculate cleanup totals"
        detail={state.previewError}
        onRetry={() => state.setRevision((value) => value + 1)}
      />
    )
  );
}

export type CleanupPreviewOptions = {
  setPreview: React.Dispatch<React.SetStateAction<CleanupPreview | undefined>>;
  setPreviewError: React.Dispatch<React.SetStateAction<string>>;
  days: number;
  api: {
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    (input: string | URL | Request, init?: RequestInit): Promise<Response>;
  };
  revision: number;
};

function useCleanupPreview({ setPreview, setPreviewError, days, api, revision }: CleanupPreviewOptions) {
  useEffect(() => {
    let active = true;
    setPreview(undefined);
    setPreviewError('');
    void previewCleanup(days, api)
      .then((value) => {
        if (active) setPreview(value);
      })
      .catch((failure: unknown) => {
        if (active) setPreviewError(String(failure));
      });
    return () => {
      active = false;
    };
  }, [days, revision]);
}
