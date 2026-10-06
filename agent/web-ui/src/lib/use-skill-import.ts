import { useEffect, useRef, useState } from 'react';
import { prepareSkillFiles, type SkillFile } from './skill-files';
import { createSkillImportAction } from './skill-import-action';

export type SkillImportOptions = {
  api: typeof fetch;
  scope: string;
  scopeLabel: string;
  onImported: () => void;
  onBusyChange: (busy: boolean) => void;
};

export function useSkillImport({ api, scope, scopeLabel, onImported, onBusyChange }: SkillImportOptions) {
  const [files, setFiles] = useState<SkillFile[]>([]);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const action = useRef<AbortController | null>(null);
  const depth = useRef(0);
  useEffect(
    () => () => {
      action.current?.abort();
      onBusyChange(false);
    },
    [onBusyChange],
  );
  const { preview } = createSkillPreview({ action, setBusy, onBusyChange, setError, setSaved, setFiles, api });
  const { importFiles } = createSkillImportAction({
    action,
    setBusy,
    onBusyChange,
    setError,
    setSaved,
    files,
    api,
    scope,
    setFiles,
    scopeLabel,
    onImported,
  });

  const ready = files.filter((file) => !file.error && file.name && file.content !== undefined).length;
  return {
    busy,
    depth,
    setDragging,
    preview,
    files,
    dragging,
    input,
    scopeLabel,
    error,
    setFiles,
    ready,
    importFiles,
    saved,
  };
}

export type SkillPreviewOptions = Pick<Parameters<typeof useSkillImport>[0], 'onBusyChange' | 'api'> & {
  action: React.RefObject<AbortController | null>;
  setBusy: React.Dispatch<React.SetStateAction<'preview' | 'import' | null>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setSaved: React.Dispatch<React.SetStateAction<string>>;
  setFiles: React.Dispatch<React.SetStateAction<SkillFile[]>>;
};

export function createSkillPreview({
  action,
  setBusy,
  onBusyChange,
  setError,
  setSaved,
  setFiles,
  api,
}: SkillPreviewOptions) {
  async function preview(selected: File[]) {
    if (action.current) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy('preview');
    onBusyChange(true);
    setError('');
    setSaved('');
    setFiles([]);
    try {
      const prepared = await prepareSkillFiles(selected);
      const readable = prepared.filter((file) => !file.error);
      let results: SkillFile[] = [];
      if (readable.length) {
        const response = await api('/api/extensions/skills/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: readable }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await response.text());
        results = ((await response.json()) as { files: SkillFile[] }).files;
      }
      let index = 0;
      if (!controller.signal.aborted)
        setFiles(prepared.map((file) => (file.error ? file : { ...file, ...results[index++] })));
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      action.current = null;
      if (!controller.signal.aborted) {
        setBusy(null);
        onBusyChange(false);
      }
    }
  }

  return { preview };
}
