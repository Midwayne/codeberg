import { useId, useState } from 'react';

import { Select } from '../ui';
import { modelOptionLabel, selectModel, type ChatModels, type ModelSelection } from '../../lib/models';
import { errorMessage } from '@agent/core/errors.js';

const DEFAULT_OPTION = '';

type ChatModelPickerProps = {
  models?: ChatModels;
  /** This chat's own model; `null` follows the default from Models. */
  value: ModelSelection | null;
  onChange: (value: ModelSelection | null) => Promise<void>;
  disabled?: boolean;
};

/** Composer control choosing the model for this chat only. */
export function ChatModelPicker({ models, value, onChange, disabled }: ChatModelPickerProps) {
  const id = useId();
  const [error, setError] = useState('');

  if (!models?.models.length) return null;

  // A choice the catalog no longer offers runs on the default, so it shows as Default.
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
        value={own?.key ?? DEFAULT_OPTION}
        onChange={(event) => choose(pickModel(event.currentTarget.value, own, models))}>
        <option value={DEFAULT_OPTION}>{defaultLabel(models)}</option>
        {models.models.map((model) => (
          <option key={model.key} value={model.key}>{modelOptionLabel(model)}</option>
        ))}
      </Select>
      {own && entry && entry.efforts.length > 1 && (
        <>
          <label htmlFor={`${id}-effort`} className="sr-only">Effort for this chat</label>
          <Select id={`${id}-effort`} disabled={disabled} title="Effort for this chat"
            className="text-xs sm:text-xs text-muted-foreground" value={own.effort}
            onChange={(event) => choose({ ...own, effort: event.currentTarget.value as ModelSelection['effort'] })}>
            {entry.efforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
          </Select>
        </>
      )}
      {error && <span role="alert" className="sr-only">{error}</span>}
      {error && <span aria-hidden="true" title={error} className="px-1 text-xs text-destructive">!</span>}
    </div>
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
