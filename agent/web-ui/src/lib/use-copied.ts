import { useState } from 'react';

const COPIED_MS = 1200;

/** Copies text to the clipboard and reports `copied` briefly; an unavailable clipboard is ignored. */
export function useCopied() {
  const [copied, setCopied] = useState(false);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      /* clipboard unavailable */
    }
  };

  return { copied, copy };
}
