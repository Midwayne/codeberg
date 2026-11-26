import type { JudgeSettings as Settings } from '@agent/core/model-types.js';

import { Toggle } from './learning-controls';
import { OptionalModel } from './optional-model';

import type { CatalogModel } from '../lib/models';

type JudgeSettingsProps = {
  models: readonly CatalogModel[];
  value: Settings;
  /** The chat model's catalog key: the model being judged. */
  chat: string;
  onChange: (value: Settings) => void;
};

/** Whether a model scores automatic evaluations of the chat model, and which one. */
export function JudgeSettings({ models, value: settings, chat, onChange }: JudgeSettingsProps) {
  const wire = (key: string | undefined) => models.find((model) => model.key === key)?.model ?? key;
  const selfGraded = settings.enabled && (!settings.model || wire(settings.model.key) === wire(chat));

  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Evaluation judge</legend>
      <Toggle
        label="Evaluation judge"
        description="Score automatic evaluations of the chat model's answers with a model. Off, evaluations use only exact and format checks against the reviewed answer."
        impact="One judge call per rubric per evaluation"
        checked={settings.enabled}
        disabled={false}
        onChange={(enabled) => onChange({ ...settings, enabled })}
      />
      <OptionalModel
        id="judge"
        models={models}
        value={settings.model}
        fallback="Same as chat model"
        disabled={!settings.enabled}
        onChange={(model) => onChange({ ...settings, model })}
      />
      <p className="text-xs leading-5 text-muted-foreground">
        Choose a model at least as capable as the chat model. Applies to the next evaluation.
      </p>
      {selfGraded && (
        <p className="text-xs leading-5 text-muted-foreground">
          The chat model is judging its own answers. Models tend to favor their own output, so these
          scores are marked self-graded; a stronger, different model gives a more independent check.
        </p>
      )}
    </fieldset>
  );
}
