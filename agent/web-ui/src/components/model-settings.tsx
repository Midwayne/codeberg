import { useModelSettingsPanel, type Choices } from '../lib/use-model-settings';
import { X } from 'lucide-react';

import { Dialog, ErrorNotice, IconButton, Select } from './ui';

import { selectModel, type CatalogModel, type ModelSelection } from '../lib/models';

export type ModelSettingsPanelProps = { onClose: () => void; onSaved: () => void };

export function ModelSettingsPanel(props: ModelSettingsPanelProps) {
  const state = useModelSettingsPanel(props);

  return <ModelSettingsPanelView {...state} />;
}

export type ModelSettingsPanelViewProps = ReturnType<typeof useModelSettingsPanel>;

function ModelSettingsPanelView({
  onClose,
  save,
  closeRef,
  draft,
  settings,
  setDraft,
  error,
  setAttempt,
  saving,
}: ModelSettingsPanelViewProps) {
  return (
    <Dialog
      label="Model settings"
      onClose={onClose}
      className="fixed inset-auto top-20 right-4 m-0 max-h-[calc(100dvh-6rem)] w-[28rem] bg-background"
    >
      <form
        className="p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Model settings</h2>
          <IconButton ref={closeRef} onClick={onClose} aria-label="Close model settings">
            <X className="size-4" />
          </IconButton>
        </div>
        {draft && settings ? (
          <ModelSettingsForm models={settings.models} value={draft} onChange={setDraft} />
        ) : !error ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading models…
          </p>
        ) : null}
        <ModelSettingsError error={error} draft={draft} save={save} setAttempt={setAttempt} />
        <ModelSettingsActions onClose={onClose} draft={draft} saving={saving} />
      </form>
    </Dialog>
  );
}

export type ModelSettingsFormProps = {
  models: readonly CatalogModel[];
  value: Choices;
  onChange: (value: Choices) => void;
};

export function ModelSettingsForm({ models, value, onChange }: ModelSettingsFormProps) {
  return (
    <div className="space-y-4">
      <ChoiceFields
        label="Chat"
        prefix="chat"
        models={models}
        value={value.chat}
        onChange={(chat) => onChange({ ...value, chat })}
      />
      <ChoiceFields
        label="Learning"
        prefix="learning"
        models={models}
        value={value.learning}
        onChange={(learning) => onChange({ ...value, learning })}
      />
      <p className="text-xs leading-5 text-muted-foreground">
        Chat changes apply to the next message. Learning changes apply to the next background job.
      </p>
    </div>
  );
}

export type ChoiceFieldsProps = {
  label: string;
  prefix: string;
  models: readonly CatalogModel[];
  value: ModelSelection;
  onChange: (value: ModelSelection) => void;
};

function ChoiceFields({ label, prefix, models, value, onChange }: ChoiceFieldsProps) {
  const selected = models.find((entry) => entry.key === value.key);
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <label htmlFor={`${prefix}-model`} className="block text-xs text-muted-foreground">
        Model
      </label>
      <Select
        id={`${prefix}-model`}
        value={value.key}
        onChange={(event) => onChange(selectModel(value, event.currentTarget.value, models))}
      >
        {models.map((model) => (
          <option key={model.key} value={model.key}>
            {model.provider} · {model.label}
            {model.key !== model.model ? ` (${model.key.slice(model.provider.length + 1)})` : ''}
          </option>
        ))}
      </Select>
      <label htmlFor={`${prefix}-effort`} className="block text-xs text-muted-foreground">
        Effort
      </label>
      <Select
        id={`${prefix}-effort`}
        value={value.effort}
        onChange={(event) => onChange({ ...value, effort: event.currentTarget.value as ModelSelection['effort'] })}
      >
        {selected?.efforts.map((effort) => (
          <option key={effort} value={effort}>
            {effort}
          </option>
        ))}
      </Select>
      {selected && (
        <p className="text-xs text-muted-foreground">
          Context window: {selected.contextWindow.toLocaleString()} tokens
        </p>
      )}
    </fieldset>
  );
}

export type ModelSettingsActionsProps = Pick<
  Parameters<typeof ModelSettingsPanelView>[0],
  'onClose' | 'draft' | 'saving'
>;

function ModelSettingsActions({ onClose, draft, saving }: ModelSettingsActionsProps) {
  return (
    <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
      <button
        type="button"
        onClick={onClose}
        className="min-h-11 rounded-lg border border-border px-4 text-sm hover:bg-accent"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={!draft || saving}
        className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save settings'}
      </button>
    </div>
  );
}

export type ModelSettingsErrorProps = Pick<
  Parameters<typeof ModelSettingsPanelView>[0],
  'error' | 'draft' | 'save' | 'setAttempt'
>;

function ModelSettingsError({ error, draft, save, setAttempt }: ModelSettingsErrorProps) {
  return (
    error && (
      <div className="mt-3">
        <ErrorNotice
          title={draft ? 'Could not save model settings' : 'Could not load models'}
          detail={error}
          onRetry={() => {
            if (draft) void save();
            else setAttempt((value) => value + 1);
          }}
        />
      </div>
    )
  );
}
