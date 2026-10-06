import { type useAddProject } from './project-add';

export type FolderPickerOptions = Pick<Parameters<typeof useAddProject>[0], 'initialPath'> & {
  busy: boolean;
  picker: React.RefObject<AbortController | null>;
  setChoosing: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  root: string;
  setRoot: React.Dispatch<React.SetStateAction<string>>;
  directoryInput: React.RefObject<HTMLInputElement | null>;
};

export function createFolderPicker({
  busy,
  picker,
  setChoosing,
  setError,
  root,
  initialPath,
  setRoot,
  directoryInput,
}: FolderPickerOptions) {
  async function chooseFolder() {
    if (busy || picker.current) return;
    const controller = new AbortController();
    picker.current = controller;
    setChoosing(true);
    setError('');
    try {
      const response = await fetch('/api/projects/pick-directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initialPath: root || initialPath }),
        signal: controller.signal,
      });
      const text = await response.text();
      let result: { path?: string; cancelled?: boolean; message?: string };
      try {
        result = JSON.parse(text) as typeof result;
      } catch {
        throw new Error(text || 'Could not open the folder picker. Enter the directory path manually.');
      }
      if (!response.ok)
        throw new Error(result.message || 'Could not open the folder picker. Enter the directory path manually.');
      if (!controller.signal.aborted && !result.cancelled) {
        if (!result.path)
          throw new Error('No directory was selected. Choose a folder again or enter the path manually.');
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

  return { chooseFolder };
}
