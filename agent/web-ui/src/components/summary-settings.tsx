import { OptionalModel } from './optional-model';

import type { CatalogModel, ModelSelection } from '../lib/models';

type SummarySettingsProps = {
  models: readonly CatalogModel[];
  value?: ModelSelection | null;
  onChange: (value: ModelSelection | null) => void;
};

/** Model that condenses older chat history. Unset follows the chat model. */
export function SummarySettings({ models, value, onChange }: SummarySettingsProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="float-left mb-2 w-full text-sm font-medium">Summaries</legend>
      <OptionalModel id="summary" models={models} value={value} fallback="Same as chat model" onChange={onChange} />
      <p className="text-xs leading-5 text-muted-foreground">
        Condenses older chat history when it nears the context budget. A smaller model lowers
        that cost; the chat model still writes every answer. Applies to the next message.
      </p>
    </fieldset>
  );
}
