import { LoadingBoundary } from './loading';
import { useModelSettingsPanel, type Choices } from '../lib/use-model-settings';
import { DecisionSettings } from './decision-settings';
import { JudgeSettings } from './judge-settings';
import { SummarySettings } from './summary-settings';
import { SubagentSettings } from './subagent-settings';
import type { DecisionModel } from '@agent/core/decisions/types.js';
import { X } from 'lucide-react';

import { Dialog, IconButton, Select } from './ui';
import { ModelSettingsActions, ModelSettingsError } from './model-settings-actions';

import { modelOptionLabel, selectModel, type CatalogModel, type ModelSelection } from '../lib/models';

type ModelSettingsPanelProps = { onClose: () => void; onSaved: () => void };

export function ModelSettingsPanel(props: ModelSettingsPanelProps) {
  const state = useModelSettingsPanel(props);

  return <ModelSettingsPanelView {...state} />;
}

type ModelSettingsPanelViewProps = ReturnType<typeof useModelSettingsPanel>;

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
      motion="anchored"
      label="Model settings"
      onClose={onClose}
      className="fixed inset-auto top-20 right-4 m-0 md:top-14 max-h-[calc(100dvh-6rem)] w-[28rem] bg-background"
    >
      <form
        className="flex max-h-[calc(100dvh-6rem)] flex-col p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="mb-5 flex shrink-0 items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Model settings</h2>
          <IconButton ref={closeRef} onClick={onClose} aria-label="Close model settings">
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <LoadingBoundary loading={!draft && !error} label="Loading models…" kind="form">
            {draft && settings && <ModelSettingsForm models={settings.models} decisionModels={settings.decisionModels} value={draft} onChange={setDraft} />}
            <ModelSettingsError error={error} draft={draft} save={save} setAttempt={setAttempt} />
          </LoadingBoundary>
        </div>
        <ModelSettingsActions onClose={onClose} draft={draft} saving={saving} />
      </form>
    </Dialog>
  );
}

type ModelSettingsFormProps = {
  models: readonly CatalogModel[];
  decisionModels?: readonly DecisionModel[];
  value: Choices;
  onChange: (value: Choices) => void;
};

export function ModelSettingsForm({ models, decisionModels = [], value, onChange }: ModelSettingsFormProps) {
  return (
    <div className="divide-y divide-border [&>*]:py-4 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
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
      <SummarySettings models={models} value={value.summary}
        onChange={(summary) => onChange({ ...value, summary })} />
      <JudgeSettings models={models} value={value.judge} chat={value.chat.key}
        onChange={(judge) => onChange({ ...value, judge })} />
      <SubagentSettings models={models} value={value.subagents}
        onChange={(subagents) => onChange({ ...value, subagents })} />
      <DecisionSettings models={decisionModels} value={value.decisions}
        onChange={(decisions) => onChange({ ...value, decisions })} />
    </div>
  );
}

type ChoiceFieldsProps = {
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
      <legend className="float-left mb-2 w-full text-sm font-medium">{label}</legend>
      <label htmlFor={`${prefix}-model`} className="block text-xs text-muted-foreground">
        Model
      </label>
      <Select
        field
        id={`${prefix}-model`}
        value={value.key}
        onChange={(event) => onChange(selectModel(value, event.currentTarget.value, models))}
      >
        {models.map((model) => (
          <option key={model.key} value={model.key}>
            {modelOptionLabel(model)}
          </option>
        ))}
      </Select>
      <label htmlFor={`${prefix}-effort`} className="block text-xs text-muted-foreground">
        Effort
      </label>
      <Select
        field
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
