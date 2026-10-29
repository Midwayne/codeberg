import type { DecisionModel } from '@agent/core/decisions/types.js';
import { Select } from './ui';

export function DecisionSettings({ models, value, onChange }: {
  models: readonly DecisionModel[];
  value?: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">Decisions API</legend>
      <label htmlFor="decisions-model" className="block text-xs text-muted-foreground">Model</label>
      <Select id="decisions-model" value={value ?? ''}
        onChange={(event) => onChange(event.currentTarget.value || null)}>
        <option value="">Off</option>
        {models.map((model) => (
          <option key={model.key} value={model.key}>{model.provider} · {model.label}</option>
        ))}
      </Select>
      <p className="text-xs leading-5 text-muted-foreground">
        Adds a decide tool the agent can use to choose files, score relevance, or check evidence.
        Chat and learning keep their selected models. Decision calls have separate provider costs.
      </p>
      {!models.length && <p className="text-xs leading-5 text-muted-foreground">
        Add decision_models in models.yml and set the provider API key, then restart Codeberg.
        {' '}<a href="/docs/models#use-a-decisions-api" className="underline underline-offset-2">Setup guide</a>
      </p>}
    </fieldset>
  );
}
