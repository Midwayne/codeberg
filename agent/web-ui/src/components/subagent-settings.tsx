import type { SubagentSettings as Settings } from '@agent/core/model-types.js';

import { Toggle } from './learning-controls';
import { OptionalModel } from './optional-model';

import type { CatalogModel } from '../lib/models';

type SubagentSettingsProps = {
  models: readonly CatalogModel[];
  value: Settings;
  onChange: (value: Settings) => void;
};

/** Whether the agent may start parallel subagents, and the model they run on. */
export function SubagentSettings({ models, value: settings, onChange }: SubagentSettingsProps) {

  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Subagents</legend>
      <Toggle
        label="Subagents"
        description="Let the agent split independent checks, such as health, metrics, and logs for several services, across parallel subagents."
        impact="Each subagent makes its own model calls"
        checked={settings.enabled}
        disabled={false}
        onChange={(enabled) => onChange({ ...settings, enabled })}
      />
      <OptionalModel
        id="subagent"
        models={models}
        value={settings.model}
        fallback="Same as summary model"
        disabled={!settings.enabled}
        onChange={(model) => onChange({ ...settings, model })}
      />
      <p className="text-xs leading-5 text-muted-foreground">
        A small, fast model keeps parallel checks cheap; the chat model reviews every report and
        writes the answer. Applies to the next message.{' '}
        <a href="/docs/tools#split-work-across-subagents" className="underline underline-offset-2">How subagents work</a>
      </p>
    </fieldset>
  );
}
