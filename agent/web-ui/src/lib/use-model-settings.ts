import { useEffect, useRef, useState } from 'react';

import { loadModelSettings, saveModelSettings, type ModelSettings } from './models';

export type Choices = Pick<ModelSettings, 'chat' | 'learning'>;

export type ModelSettingsPanelOptions = { onClose: () => void; onSaved: () => void };

export function useModelSettingsPanel({ onClose, onSaved }: ModelSettingsPanelOptions) {
  const [settings, setSettings] = useState<ModelSettings>();
  const [draft, setDraft] = useState<Choices>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    setError('');
    void loadModelSettings()
      .then((value) => {
        if (!active) return;
        setSettings(value);
        setDraft({ chat: value.chat, learning: value.learning });
      })
      .catch((failure: unknown) => {
        if (active) setError(String(failure));
      });
    closeRef.current?.focus();
    return () => {
      active = false;
    };
  }, [attempt]);

  async function save(): Promise<void> {
    if (!draft || saving) return;
    setSaving(true);
    setError('');
    try {
      const updated = await saveModelSettings(draft);
      setSettings(updated);
      onSaved();
      onClose();
    } catch (failure) {
      setError(String(failure));
    } finally {
      setSaving(false);
    }
  }
  return { onClose, save, closeRef, draft, settings, setDraft, error, setAttempt, saving };
}
