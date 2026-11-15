import { Select } from './ui';

import { selectModel, type CatalogModel, type ModelSelection } from '../lib/models';

export type SummarySettingsProps = {
  models: readonly CatalogModel[];
  value?: ModelSelection | null;
  onChange: (value: ModelSelection | null) => void;
};

/** Model that condenses older chat history. Unset follows the chat model. */
export function SummarySettings({ models, value, onChange }: SummarySettingsProps) {
  const selected = models.find((entry) => entry.key === value?.key);
  const current: ModelSelection = value ?? { key: '', effort: 'provider-default' };

  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">Summaries</legend>
      <label htmlFor="summary-model" className="block text-xs text-muted-foreground">
        Model
      </label>
      <Select
        id="summary-model"
        value={value?.key ?? ''}
        onChange={(event) => {
          const key = event.currentTarget.value;

          onChange(key ? selectModel(current, key, models) : null);
        }}
      >
        <option value="">Same as chat model</option>
        {models.map((model) => (
          <option key={model.key} value={model.key}>
            {model.provider} · {model.label}
            {model.key !== model.model ? ` (${model.key.slice(model.provider.length + 1)})` : ''}
          </option>
        ))}
      </Select>
      {value && selected && (
        <SummaryEffort value={value} efforts={selected.efforts} onChange={onChange} />
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        Condenses older chat history when it nears the context budget. A smaller model lowers
        that cost; the chat model still writes every answer. Applies to the next message.
      </p>
    </fieldset>
  );
}

type SummaryEffortProps = {
  value: ModelSelection;
  efforts: readonly ModelSelection['effort'][];
  onChange: (value: ModelSelection) => void;
};

function SummaryEffort({ value, efforts, onChange }: SummaryEffortProps) {
  return (
    <>
      <label htmlFor="summary-effort" className="block text-xs text-muted-foreground">
        Effort
      </label>
      <Select
        id="summary-effort"
        value={value.effort}
        onChange={(event) =>
          onChange({ ...value, effort: event.currentTarget.value as ModelSelection['effort'] })
        }
      >
        {efforts.map((effort) => (
          <option key={effort} value={effort}>
            {effort}
          </option>
        ))}
      </Select>
    </>
  );
}
