import { useCallback, useEffect, useRef } from 'react';
import { isToolSettings, type ToolSettings } from '@agent/core/web/types.js';

export function useToolSettingsRequest(onSettings: (value: ToolSettings) => void, onError: (value: string) => void) {
  const pending = useRef<AbortController | null>(null);
  const load = useCallback(async (init?: RequestInit) => {
    if (!init && pending.current) return;

    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;

    try {
      const value = await requestSettings(init, AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]));
      if (controller.signal.aborted) return;

      onSettings(value);
      onError('');
    } catch (error) {
      if (!controller.signal.aborted) onError(error instanceof Error ? error.message : String(error));
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }, [onSettings, onError]);

  useEffect(() => () => {
    pending.current?.abort();
    pending.current = null;
  }, []);

  return load;
}

async function requestSettings(init: RequestInit | undefined, signal: AbortSignal): Promise<ToolSettings> {
  const response = await fetch('/api/settings/tools', { ...init, signal });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body ? body.error : undefined;

    throw new Error(typeof message === 'string' ? message : 'Tool settings unavailable. Retry.');
  }
  if (!isToolSettings(body)) throw new Error('Invalid tool settings response. Retry.');

  return body;
}
