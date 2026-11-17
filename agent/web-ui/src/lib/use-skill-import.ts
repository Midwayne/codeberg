import { useEffect, useRef, useState } from 'react';

import type { SkillFile } from './skill-files';
import { importSkillFiles, previewSkillFiles } from './skill-import-requests';
import { errorMessage } from '@agent/core/errors.js';

export type SkillImportOptions = {
  api: typeof fetch;
  scope: string;
  scopeLabel: string;
  onImported: () => void;
  onBusyChange: (busy: boolean) => void;
};

type SkillAction = 'preview' | 'import';

export function useSkillImport({ api, scope, scopeLabel, onImported, onBusyChange }: SkillImportOptions) {
  const [files, setFiles] = useState<SkillFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const { busy, run } = useExclusiveSkillAction(onBusyChange);

  const preview = (selected: File[]) =>
    run('preview', async (signal) => {
      setError('');
      setSaved('');
      setFiles([]);

      try {
        const previewed = await previewSkillFiles(selected, api, signal);
        if (!signal.aborted) setFiles(previewed);
      } catch (reason) {
        if (!signal.aborted) setError(errorMessage(reason));
      }
    });

  const importFiles = () =>
    run('import', async (signal) => {
      setError('');
      setSaved('');

      const { imported, remaining } = await importSkillFiles(files, scope, api, signal);
      if (signal.aborted) return;

      setFiles(remaining);
      if (!imported) return;

      const noun = imported === 1 ? 'skill' : 'skills';
      setSaved(`${imported} ${noun} imported into ${scopeLabel}. Available on the next chat turn.`);
      onImported();
    });

  const ready = files.filter((file) => !file.error && file.name && file.content !== undefined).length;

  return {
    busy, files, ready, error, saved, dragging, scopeLabel,
    input, depth, setDragging, setFiles, preview, importFiles,
  };
}

/** Runs one preview or import at a time, and aborts the running one when the form unmounts. */
function useExclusiveSkillAction(onBusyChange: (busy: boolean) => void) {
  const [busy, setBusy] = useState<SkillAction | null>(null);
  const action = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      action.current?.abort();
      onBusyChange(false);
    },
    [onBusyChange],
  );

  async function run(kind: SkillAction, work: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (action.current) return;

    const controller = new AbortController();
    action.current = controller;
    setBusy(kind);
    onBusyChange(true);

    try {
      await work(controller.signal);
    } finally {
      action.current = null;

      if (!controller.signal.aborted) {
        setBusy(null);
        onBusyChange(false);
      }
    }
  }

  return { busy, run };
}
