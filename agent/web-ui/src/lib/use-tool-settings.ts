import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToolSettings } from '@agent/core/web/types.js';
import { useToolSettingsRequest } from './use-tool-settings-request';

export function useToolSettings() {
  const [settings, setSettings] = useState<ToolSettings>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const load = useToolSettingsRequest(setSettings, setError);
  const refresh = useCallback(() => load(), [load]);
  const change = async (webSearch: boolean) => {
    if (saving.current) return;

    saving.current = true;
    setBusy(true);
    try {
      await load({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ webSearch }) });
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (settings?.status !== 'starting' || busy || error) return;

    const timer = window.setInterval(() => void refresh(), 1500);

    return () => window.clearInterval(timer);
  }, [settings?.status, busy, error, refresh]);

  return { settings, busy, error, refresh, change };
}
