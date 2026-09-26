import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  loadModelSettings,
  saveModelSettings,
  selectModel,
  type CatalogModel,
  type ModelSelection,
  type ModelSettings,
} from '@/lib/models';

type Choices = Pick<ModelSettings, 'chat' | 'learning'>;

export function ModelSettingsPanel({ onClose, onSaved }: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [settings, setSettings] = useState<ModelSettings>();
  const [draft, setDraft] = useState<Choices>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    void loadModelSettings().then((value) => {
      if (!active) return;
      setSettings(value);
      setDraft({ chat: value.chat, learning: value.learning });
    }).catch((failure: unknown) => {
      if (active) setError(String(failure));
    });
    closeRef.current?.focus();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [onClose]);

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

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <button type="button" aria-label="Close settings" className="absolute inset-0 size-full bg-black/40" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Model settings"
        className="absolute top-14 right-3 w-[min(26rem,calc(100vw-1.5rem))] rounded-xl border border-border bg-background p-4 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Model settings</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close model settings" className="rounded-md p-1 text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
            <X className="size-4" />
          </button>
        </div>
        {draft && settings ? (
          <ModelSettingsForm models={settings.models} value={draft} onChange={setDraft} />
        ) : !error ? <p className="text-xs text-muted-foreground">Loading models…</p> : null}
        {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-4 flex justify-end">
          <button type="button" disabled={!draft || saving} onClick={() => void save()} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </section>
    </div>
  );
}

export function ModelSettingsForm({ models, value, onChange }: {
  models: readonly CatalogModel[];
  value: Choices;
  onChange: (value: Choices) => void;
}) {
  return (
    <div className="space-y-4">
      <ChoiceFields label="Chat" prefix="chat" models={models} value={value.chat} onChange={(chat) => onChange({ ...value, chat })} />
      <ChoiceFields label="Learning" prefix="learning" models={models} value={value.learning} onChange={(learning) => onChange({ ...value, learning })} />
      <p className="text-[11px] text-muted-foreground">Chat changes apply to the next message. Learning changes apply to the next background job.</p>
    </div>
  );
}

function ChoiceFields({ label, prefix, models, value, onChange }: {
  label: string;
  prefix: string;
  models: readonly CatalogModel[];
  value: ModelSelection;
  onChange: (value: ModelSelection) => void;
}) {
  const selected = models.find((entry) => entry.key === value.key);
  return (
    <fieldset className="space-y-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-medium">{label}</legend>
      <label htmlFor={`${prefix}-model`} className="block text-xs text-muted-foreground">Model</label>
      <select
        id={`${prefix}-model`}
        value={value.key}
        onChange={(event) => onChange(selectModel(value, event.currentTarget.value, models))}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        {models.map((model) => (
          <option key={model.key} value={model.key}>{model.provider} · {model.label}{model.key !== model.model ? ` (${model.key.slice(model.provider.length + 1)})` : ''}</option>
        ))}
      </select>
      <label htmlFor={`${prefix}-effort`} className="block text-xs text-muted-foreground">Effort</label>
      <select
        id={`${prefix}-effort`}
        value={value.effort}
        onChange={(event) => onChange({ ...value, effort: event.currentTarget.value as ModelSelection['effort'] })}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        {selected?.efforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
      </select>
      {selected && <p className="text-[11px] text-muted-foreground">Context window: {selected.contextWindow.toLocaleString()} tokens</p>}
    </fieldset>
  );
}
