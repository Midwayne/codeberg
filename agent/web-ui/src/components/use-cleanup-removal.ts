import { useState } from 'react';

import { cleanupResources, formatBytes, type CleanupCategory } from '../lib/resources';

type CleanupRemovalOptions = {
  selected: CleanupCategory[];
  days: number;
  api: typeof fetch;
  /** Runs in the same update as the outcome message, whether or not files were deleted. */
  onSettled: (succeeded: boolean) => void;
};

/** Deletes the selected categories and owns the progress and outcome of that request. */
export function useCleanupRemoval({ selected, days, api, onSettled }: CleanupRemovalOptions) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  async function remove() {
    setBusy(true);
    setError('');
    setResult('');

    try {
      const removed = await cleanupResources(selected, days, api);
      const failed = removed.failed
        ? ` ${removed.failed} files could not be deleted. Check file permissions and try again.`
        : '';

      setResult(`Deleted ${removed.deleted} files and freed ${formatBytes(removed.bytesFreed)}.${failed}`);
      window.dispatchEvent(new CustomEvent('codeberg:storage-cleaned', { detail: removed }));
      onSettled(true);
    } catch (failure) {
      setError(String(failure));
      onSettled(false);
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, result, setError, setResult, remove };
}
