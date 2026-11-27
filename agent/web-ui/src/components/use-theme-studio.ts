import { useEffect, useRef, useState } from 'react';

import { commitTheme, restoreTheme } from '../lib/theme-commit';
import { activeThemeId } from '../lib/themes';
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
  const editRequest = useEditRequest(editing?.id, cancel);

  // A different theme (or none, after a delete) starts fresh, with nothing to undo.
  useEffect(() => {
    setPrevious(undefined);
    setError(undefined);
  }, [editing?.id]);

  async function create() {
    const text = prompt.trim();
    if (!text || pending) return;

    const activeAtStart = activeThemeId();

    await run(async (signal) => {
      const base = editing ?? (refine ? selected : undefined);
      const theme = await editRequest(editing?.id, () =>
        generateTheme(fetch, { prompt: text, animated, base, id: editing?.id }, signal));

      if (!commitTheme(theme, { editing, activeAtStart })) return;

      setPrevious(editing);
      setPrompt('');
    });
  }

  function undo() {
    if (!previous || pending) return;

    restoreTheme(previous);
    setPrevious(undefined);
  }

  return { prompt, setPrompt, animated, setAnimated, refine, setRefine, pending, error, previous, create, undo, cancel };
}

/**
 * Tracks which theme a running request edits. Editing a different theme (or
 * none, after a delete) cancels that edit, since it belonged to the old theme;
 * a new theme being designed carries on. The mark is set only while a request
 * runs, so a refused double submit cannot clear the mark of the one in flight.
 */
function useEditRequest(editingId: string | undefined, cancel: () => void) {
  const runningEdit = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (runningEdit.current && runningEdit.current !== editingId) cancel();
  }, [editingId]);

  return async function editRequest<T>(id: string | undefined, request: () => Promise<T>): Promise<T> {
    runningEdit.current = id;

    try {
      return await request();
    } finally {
      runningEdit.current = undefined;
    }
  };
}
