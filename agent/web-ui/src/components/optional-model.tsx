import { Select } from './ui';

import { modelOptionLabel, selectModel, type CatalogModel, type ModelSelection } from '../lib/models';

type OptionalModelProps = {
  id: string;
  models: readonly CatalogModel[];
  value?: ModelSelection | null;
  /** Label of the empty choice, e.g. "Same as chat model". */
  fallback: string;
  disabled?: boolean;
  onChange: (value: ModelSelection | null) => void;
};

/** A model picker whose empty choice follows another model, plus its effort once chosen. */
export function OptionalModel({ id, models, value, fallback, disabled = false, onChange }: OptionalModelProps) {
  const selected = models.find((entry) => entry.key === value?.key);
  const current: ModelSelection = value ?? { key: '', effort: 'provider-default' };

  return (
    <>
      <label htmlFor={`${id}-model`} className="block text-xs text-muted-foreground">
        Model
      </label>
      <Select
        field
        id={`${id}-model`}
        value={value?.key ?? ''}
        disabled={disabled}
        onChange={(event) => {
          const key = event.currentTarget.value;

          onChange(key ? selectModel(current, key, models) : null);
        }}
      >
        <option value="">{fallback}</option>
        {models.map((model) => (
          <option key={model.key} value={model.key}>
            {modelOptionLabel(model)}
          </option>
        ))}
      </Select>
      <OptionalEffort
        id={id}
        value={value && selected ? value : null}
        efforts={selected?.efforts ?? []}
        fallback={fallback}
        disabled={disabled}
        onChange={onChange}
      />
    </>
  );
}

type OptionalEffortProps = {
  id: string;
  /** Null while the model follows another one; the effort follows it too. */
  value: ModelSelection | null;
  efforts: readonly ModelSelection['effort'][];
  fallback: string;
  disabled: boolean;
  onChange: (value: ModelSelection) => void;
};

/** Effort for the chosen model; shown disabled while the model follows another one. */
function OptionalEffort({ id, value, efforts, fallback, disabled, onChange }: OptionalEffortProps) {
  const hint = `${id}-effort-hint`;

  return (
    <>
      <label htmlFor={`${id}-effort`} className="block text-xs text-muted-foreground">
        Effort
      </label>
      <Select
        field
        id={`${id}-effort`}
        value={value?.effort ?? ''}
        disabled={disabled || !value}
        aria-describedby={value ? undefined : hint}
        onChange={(event) => {
          if (value) onChange({ ...value, effort: event.currentTarget.value as ModelSelection['effort'] });
        }}
      >
        {value
          ? efforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)
          : <option value="">{fallback}</option>}
      </Select>
      {!value && <p id={hint} className="text-xs text-muted-foreground">Pick a model above to choose its effort.</p>}
    </>
  );
}
