import { useCallback, useState } from 'react';

export const COPIED_FLAG_MS = 1200;

export function useClipboard(text: string): { copied: boolean; copy: () => Promise<void> } {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_FLAG_MS);
    } catch {
      /* clipboard unavailable */
    }
  }, [text]);

  return { copied, copy };
}
