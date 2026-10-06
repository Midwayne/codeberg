import { useEffect, useRef, useState } from 'react';

import { loadLearningSettings, saveLearningSettings, type LearningSettings } from './learning-settings';
import { useProjectApi } from './project-api';

export type LearningSettingsPanelOptions = { onSaved?: () => void };

export function useLearningSettingsPanel({ onSaved }: LearningSettingsPanelOptions) {
  const { fetch: api, project } = useProjectApi();
  const [settings, setSettings] = useState<LearningSettings | null>();
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
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
        if (current) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      current = false;
      active.current = false;
    };
  }, [api, retry]);
  const { change } = createLearningChange({
    saving,
    settings,
    setBusy,
    setError,
    setSaved,
    setSettings,
    api,
    active,
    onSaved,
  });

  return { project, error, settings, setRetry, busy, change, saved };
}

export type LearningChangeOptions = Pick<Parameters<typeof useLearningSettingsPanel>[0], 'onSaved'> & {
  saving: React.RefObject<boolean>;
  settings: LearningSettings | null | undefined;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setSaved: React.Dispatch<React.SetStateAction<boolean>>;
  setSettings: React.Dispatch<React.SetStateAction<LearningSettings | null | undefined>>;
  api: typeof fetch;
  active: React.RefObject<boolean>;
};

export function createLearningChange({
  saving,
  settings,
  setBusy,
  setError,
  setSaved,
  setSettings,
  api,
  active,
  onSaved,
}: LearningChangeOptions) {
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
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      saving.current = false;
      if (active.current) setBusy(false);
    }
  };

  return { change };
}
