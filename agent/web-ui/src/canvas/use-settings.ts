import { useCallback, useEffect, useState } from 'react';
import { useProjectApi } from '../lib/project-api';
import { ensureOk, jsonInit, readJson } from '../lib/http';

export function useCanvasSettings() {
  const { project, fetch } = useProjectApi();
  const [enabled, setEnabled] = useState<boolean>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/canvas');
      if (!response.ok) throw new Error('Canvas settings unavailable. Retry.');

      setEnabled((await readJson<{ enabled: boolean }>(response)).enabled);
      setError('');
    } catch (error) {
      setError(String(error));
    }
  }, [fetch]);
  useEffect(() => {
    void refresh();
    const listener = () => void refresh();
    window.addEventListener('codeberg-canvas-settings', listener);
    return () => window.removeEventListener('codeberg-canvas-settings', listener);
  }, [refresh]);
  const change = async (value: boolean) => {
    setBusy(true);
    try {
      const response = await fetch('/api/settings/canvas', jsonInit('PUT', { enabled: value }));
      await ensureOk(response, 'Unable to save canvas settings.');

      setEnabled(value);
      setError('');
      window.dispatchEvent(new Event('codeberg-canvas-settings'));
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  return { project, enabled, error, busy, refresh, change };
}
