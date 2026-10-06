import { cleanupResources, formatBytes, type CleanupCategory } from '../lib/resources';

export type CleanupActionOptions = {
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setResult: React.Dispatch<React.SetStateAction<string>>;
  selected: CleanupCategory[];
  days: number;
  api: typeof fetch;
  setConfirming: React.Dispatch<React.SetStateAction<boolean>>;
  setSelected: React.Dispatch<React.SetStateAction<CleanupCategory[]>>;
  setRevision: React.Dispatch<React.SetStateAction<number>>;
};

export function createCleanupAction({
  setBusy,
  setError,
  setResult,
  selected,
  days,
  api,
  setConfirming,
  setSelected,
  setRevision,
}: CleanupActionOptions) {
  async function remove() {
    setBusy(true);
    setError('');
    setResult('');
    try {
      const removed = await cleanupResources(selected, days, api);
      setResult(
        `Deleted ${removed.deleted} files and freed ${formatBytes(removed.bytesFreed)}.${removed.failed ? ` ${removed.failed} files could not be deleted. Check file permissions and try again.` : ''}`,
      );
      window.dispatchEvent(new CustomEvent('codeberg:storage-cleaned', { detail: removed }));
      setConfirming(false);
      setSelected([]);
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(String(failure));
      setConfirming(false);
      setRevision((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  return { remove };
}
