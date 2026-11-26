import { OptionalModel } from './optional-model';

import type { CatalogModel, ModelSelection } from '../lib/models';

type JudgeSettingsProps = {
  models: readonly CatalogModel[];
  value?: ModelSelection | null;
  /** The chat model's catalog key: the model being judged. */
  chat: string;
  onChange: (value: ModelSelection | null) => void;
};

/** Model that scores automatic evaluations of the chat model. Unset follows the chat model. */
export function JudgeSettings({ models, value, chat, onChange }: JudgeSettingsProps) {
  const wire = (key: string | undefined) => models.find((model) => model.key === key)?.model ?? key;
  const selfGraded = !value || wire(value.key) === wire(chat);

  return (
    <fieldset className="space-y-2">
      <legend className="float-left mb-2 w-full text-sm font-medium">Evaluation judge</legend>
      <OptionalModel id="judge" models={models} value={value} fallback="Same as chat model" onChange={onChange} />
      <p className="text-xs leading-5 text-muted-foreground">
        Scores automatic evaluations of the chat model&apos;s answers. Choose a model at least as capable as
        the chat model. Applies to the next evaluation.
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
