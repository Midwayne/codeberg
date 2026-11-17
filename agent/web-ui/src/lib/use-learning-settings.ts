import { useEffect, useRef, useState } from 'react';

import { loadLearningSettings, saveLearningSettings, type LearningSettings } from './learning-settings';
import { useProjectApi } from './project-api';
import { errorMessage } from '@agent/core/errors.js';

type LearningSettingsPanelOptions = { onSaved?: () => void };

export function useLearningSettingsPanel({ onSaved }: LearningSettingsPanelOptions) {
  const { fetch: api, project } = useProjectApi();
  const { settings, setSettings, error, setError, setRetry, active } = useLoadedLearningSettings(api);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const saving = useRef(false);

  /** Shows the change at once and restores the previous settings if the save fails. */
  const change = async (next: LearningSettings) => {
    if (saving.current || !settings) return;

    const previous = settings;
    saving.current = true;
    setBusy(true);
    setError('');
    setSaved(false);
    setSettings(next);

    try {
      const value = await saveLearningSettings(next, api);
      if (active.current) {
        setSettings(value);
        setSaved(true);
        onSaved?.();
      }
    } catch (reason) {
      if (active.current) {
        setSettings(previous);
        setError(errorMessage(reason));
      }
    } finally {
      saving.current = false;
      if (active.current) setBusy(false);
    }
  };

  return { project, error, settings, setRetry, busy, change, saved };
}

/** Loads the settings; `active` tells a late save whether this load is still the current one. */
export function useLoadedLearningSettings(api: typeof fetch) {
  const [settings, setSettings] = useState<LearningSettings | null>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    let current = true;
    setError('');

    void loadLearningSettings(api)
      .then((value) => {
        if (current) setSettings(value);
      })
      .catch((reason: unknown) => {
        if (current) setError(errorMessage(reason));
      });

    return () => {
      current = false;
      active.current = false;
    };
  }, [api, retry]);

  return { settings, setSettings, error, setError, setRetry, active };
}
