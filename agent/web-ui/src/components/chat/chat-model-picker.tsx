import { useId, useState } from 'react';

import { Select } from '../ui';
import { modelOptionLabel, selectModel, type CatalogModel, type ChatModels, type ModelSelection } from '../../lib/models';
import { errorMessage } from '@agent/core/errors.js';

const DEFAULT_OPTION = '';
const UNAVAILABLE_OPTION = '__unavailable__';

type ChatModelPickerProps = {
  models?: ChatModels;
  /** This chat's own model; `null` follows the default from Models. */
  value: ModelSelection | null;
  onChange: (value: ModelSelection | null) => Promise<void>;
  /** Inputs the chat's earlier files need; models without them cannot continue it. */
  required?: readonly CatalogModel['inputs'][number][];
  disabled?: boolean;
};

/** Composer control choosing the model for this chat only. */
export function ChatModelPicker({ models, value, onChange, required = [], disabled }: ChatModelPickerProps) {
  const id = useId();
  const [error, setError] = useState('');

  if (!models?.models.length) return null;

  const entry = value && models.models.find((model) => model.key === value.key && model.efforts.includes(value.effort));
  const own = entry ? value : null;

  const choose = (next: ModelSelection | null) => {
    setError('');

    onChange(next).catch((failure: unknown) => setError(errorMessage(failure, "Could not save the chat's model.")));
  };

  return (
    <div className="flex min-w-0 items-center">
      <label htmlFor={`${id}-model`} className="sr-only">Model for this chat</label>
      <Select id={`${id}-model`} disabled={disabled} title="Model for this chat"
        wrapperClassName="min-w-0 max-w-[11rem] sm:max-w-[16rem]" className="text-xs sm:text-xs text-muted-foreground"
        value={own?.key ?? (value ? UNAVAILABLE_OPTION : DEFAULT_OPTION)}
        onChange={(event) => choose(pickModel(event.currentTarget.value, own, models))}>
        <ModelOptions models={models} value={value} listed={Boolean(own)} required={required} />
      </Select>
      {own && entry && entry.efforts.length > 1 && (
        <EffortSelect id={`${id}-effort`} efforts={entry.efforts} value={own} disabled={disabled} onChange={choose} />
      )}
      {error && <span role="alert" title={error} className="px-1 text-xs text-destructive">Not saved</span>}
    </div>
  );
}

type ModelOptionsProps = { models: ChatModels; value: ModelSelection | null; listed: boolean; required: readonly CatalogModel['inputs'][number][] };

/** Models that cannot read the chat's earlier files are shown but cannot be chosen. */
function ModelOptions({ models, value, listed, required }: ModelOptionsProps) {
  const fits = (model?: CatalogModel) => !model || required.every((input) => model.inputs.includes(input));
  const fallback = models.models.find((model) => model.key === models.chat.key);

  return (
    <>
      <option value={DEFAULT_OPTION} disabled={value !== null && !fits(fallback)}>{defaultLabel(models)}</option>
      {value && !listed && (
        <option value={UNAVAILABLE_OPTION} disabled>{`${value.key} · unavailable, using default`}</option>
      )}
      {models.models.map((model) => (
        <option key={model.key} value={model.key} disabled={model.key !== value?.key && !fits(model)}>
          {fits(model) ? modelOptionLabel(model) : `${modelOptionLabel(model)} · can't read this chat's files`}
        </option>
      ))}
    </>
  );
}

type EffortSelectProps = {
  id: string;
  efforts: readonly ModelSelection['effort'][];
  value: ModelSelection;
  disabled?: boolean;
  onChange: (value: ModelSelection) => void;
};

function EffortSelect({ id, efforts, value, disabled, onChange }: EffortSelectProps) {
  return (
    <>
      <label htmlFor={id} className="sr-only">Effort for this chat</label>
      <Select id={id} disabled={disabled} title="Effort for this chat"
        className="text-xs sm:text-xs text-muted-foreground" value={value.effort}
        onChange={(event) => onChange({ ...value, effort: event.currentTarget.value as ModelSelection['effort'] })}>
        {efforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
      </Select>
    </>
  );
}

function defaultLabel(models: ChatModels): string {
  const entry = models.models.find((model) => model.key === models.chat.key);

  return entry ? `Default (${entry.label} · ${models.chat.effort})` : 'Default';
}

/** A new model keeps the effort it shares with the default, else its first effort. */
export function pickModel(key: string, own: ModelSelection | null, models: ChatModels): ModelSelection | null {
  if (key === DEFAULT_OPTION) return null;

  return selectModel(own ?? models.chat, key, models.models);
}
