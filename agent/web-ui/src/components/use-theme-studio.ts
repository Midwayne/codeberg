import { useEffect, useRef, useState } from 'react';

import { saveCustomTheme } from '../lib/custom-themes';
import { useProjectApi } from '../lib/project-api';
import { generateTheme } from '../lib/theme-generate';
import { changeTheme } from '../lib/theme-transition';
import type { Theme } from '../lib/theme-types';

/** Form state for describing a theme and having the chat model design it. */
export function useThemeStudio(selected: Theme) {
  const { fetch } = useProjectApi();
  const [prompt, setPrompt] = useState('');
  const [animated, setAnimated] = useState(true);
  const [refine, setRefine] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  async function create() {
    const text = prompt.trim();
    if (!text || pending) return;

    const abort = new AbortController();
    request.current = abort;
    setPending(true);
    setError(undefined);

    try {
      const theme = await generateTheme(fetch, { prompt: text, animated, base: refine ? selected : undefined }, abort.signal);

      saveCustomTheme(theme);
      changeTheme(theme.id);
      setPrompt('');
    } catch (failure) {
      if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not create a theme.');
    } finally {
      if (request.current === abort) request.current = null;

      setPending(false);
    }
  }

  return {
    prompt,
    setPrompt,
    animated,
    setAnimated,
    refine,
    setRefine,
    pending,
    error,
    create,
    cancel: () => request.current?.abort(),
  };
}
