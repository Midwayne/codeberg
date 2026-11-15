import { useEffect, useRef, useState } from 'react';

const PICKER_UNAVAILABLE = 'Could not open the folder picker. Enter the directory path manually.';

export type FolderPickerOptions = {
  /** True while the form is submitting; the picker stays closed. */
  busy: boolean;
  root: string;
  initialPath?: string;
  setRoot: (path: string) => void;
  setError: (message: string) => void;
};

/** Opens the server's native folder dialog, one at a time, and aborts it when the form unmounts. */
export function useFolderPicker({ busy, root, initialPath, setRoot, setError }: FolderPickerOptions) {
  const [choosing, setChoosing] = useState(false);
  const picker = useRef<AbortController | null>(null);
  const directoryInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => picker.current?.abort(), []);

  async function chooseFolder() {
    if (busy || picker.current) return;

    const controller = new AbortController();
    picker.current = controller;
    setChoosing(true);
    setError('');

    try {
      const result = await pickDirectory(root || initialPath, controller.signal);

      if (!controller.signal.aborted && !result.cancelled) {
        if (!result.path) {
          throw new Error('No directory was selected. Choose a folder again or enter the path manually.');
        }

        setRoot(result.path);
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (!controller.signal.aborted) {
        setChoosing(false);
        directoryInput.current?.focus();
      }

      picker.current = null;
    }
  }

  return { choosing, directoryInput, chooseFolder };
}

type PickedDirectory = { path?: string; cancelled?: boolean; message?: string };

async function pickDirectory(initialPath: string | undefined, signal: AbortSignal): Promise<PickedDirectory> {
  const response = await fetch('/api/projects/pick-directory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initialPath }),
    signal,
  });

  const text = await response.text();
  let result: PickedDirectory;

  try {
    result = JSON.parse(text) as PickedDirectory;
  } catch {
    throw new Error(text || PICKER_UNAVAILABLE);
  }

  if (!response.ok) throw new Error(result.message || PICKER_UNAVAILABLE);

  return result;
}
