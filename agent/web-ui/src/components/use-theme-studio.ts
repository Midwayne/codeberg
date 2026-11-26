import { useEffect, useRef, useState } from 'react';

import { commitTheme, restoreTheme } from '../lib/theme-commit';
import { useProjectApi } from '../lib/project-api';
import { generateTheme } from '../lib/theme-generate';
import type { CustomTheme, Theme } from '../lib/theme-types';
import { useThemeRequest } from './use-theme-request';

/**
 * Form state for the theme studio. With `editing`, the chat model changes that
 * saved theme in place and the previous version can be restored with Undo.
 */
export function useThemeStudio(selected: Theme, editing?: CustomTheme) {
  const { fetch } = useProjectApi();
  const [prompt, setPrompt] = useState('');
  const [animated, setAnimated] = useState(true);
  const [refine, setRefine] = useState(false);
  const [previous, setPrevious] = useState<CustomTheme>();
  const { pending, error, setError, run, cancel } = useThemeRequest();
  const runningEdit = useRef<string | undefined>(undefined);

  // Editing a different theme (or none, after a delete) starts fresh. A running
  // edit belonged to the old theme, so it stops; a new theme being designed goes on.
  useEffect(() => {
    if (runningEdit.current && runningEdit.current !== editing?.id) cancel();

    setPrevious(undefined);
    setError(undefined);
  }, [editing?.id]);

  async function create() {
    const text = prompt.trim();
    if (!text || pending) return;

    runningEdit.current = editing?.id;

    await run(async (signal) => {
      const base = editing ?? (refine ? selected : undefined);
      const theme = await generateTheme(fetch, { prompt: text, animated, base, id: editing?.id }, signal);

      if (!commitTheme(theme, editing)) return;

      setPrevious(editing);
      setPrompt('');
    });

    runningEdit.current = undefined;
  }

  function undo() {
    if (!previous || pending) return;

    restoreTheme(previous);
    setPrevious(undefined);
  }

  return { prompt, setPrompt, animated, setAnimated, refine, setRefine, pending, error, previous, create, undo, cancel };
}
