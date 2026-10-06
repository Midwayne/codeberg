import { Components, Toggle } from './learning-controls';

import { DATASET_KINDS } from '@agent/core/learning/preferences';
import { type LearningSettings } from '../lib/learning-settings';
import { KIND_LABELS } from '../lib/training';

import { type LearningSettingsView } from './learning-settings';

export type HistorySettingsProps = Pick<Parameters<typeof LearningSettingsView>[0], 'settings'> & {
  locked: boolean;
  set: (key: keyof LearningSettings, value: boolean) => void;
};

export function HistorySettings({ settings, locked, set }: HistorySettingsProps) {
  return (
    <div className="py-5">
      <Toggle
        label="Learning history"
        description="Keep previous investigations available as local learning context."
        impact="No model calls to record"
        checked={settings.history}
        disabled={locked}
        onChange={(value) => set('history', value)}
      />
      <div className="pl-4 sm:pl-5">
        <Toggle
          label="Record chats and feedback"
          description="Save answers, tool results, corrections, and ratings locally. Turn off to stop new collection."
          checked={settings.historyCapture}
          disabled={locked || !settings.history}
          onChange={(value) => set('historyCapture', value)}
          small
        />
        <Toggle
          label="Use history in chats"
          description="Search earlier attempts and feedback. Retrieved history adds context tokens."
          checked={settings.historyRecall}
          disabled={locked || !settings.history}
          onChange={(value) => set('historyRecall', value)}
          small
        />
      </div>
      {(!settings.history || !settings.historyCapture) && (
        <p className="pl-4 text-xs leading-5 text-muted-foreground sm:pl-5">
          New knowledge and dataset capture need recorded history. Existing queued work can still run.
        </p>
      )}
    </div>
  );
}

export type DatasetSettingsProps = Pick<Parameters<typeof LearningSettingsView>[0], 'settings' | 'onChange'> & {
  locked: boolean;
  set: (key: keyof LearningSettings, value: boolean) => void;
};

export function DatasetSettings({ settings, locked, set, onChange }: DatasetSettingsProps) {
  return (
    <div className="pt-5">
      <Toggle
        label="Dataset capture"
        description="Derive reviewable examples from recorded answers and feedback."
        impact="No model calls"
        checked={settings.datasets}
        disabled={locked}
        onChange={(value) => set('datasets', value)}
      />
      <fieldset disabled={locked || !settings.datasets} className="min-w-0 pl-4 sm:pl-5">
        <legend className="sr-only">Dataset components</legend>
        <Toggle
          label="Training review"
          description="Allow reviewed examples to be approved for future training exports."
          checked={settings.training}
          disabled={locked || !settings.datasets}
          onChange={(value) => set('training', value)}
          small
        />
        <Toggle
          label="Evaluations"
          description="Allow independently checked examples to be saved as held-out test cases. No model calls."
          checked={settings.evals}
          disabled={locked || !settings.datasets}
          onChange={(value) => set('evals', value)}
          small
        />
        <Components label="Example types" disabled={locked || !settings.datasets}>
          {DATASET_KINDS.map((key) => (
            <Toggle
              key={key}
              label={KIND_LABELS[key]}
              checked={settings.kinds[key]}
              disabled={locked || !settings.datasets}
              onChange={(value) => onChange({ ...settings, kinds: { ...settings.kinds, [key]: value } })}
              small
            />
          ))}
        </Components>
      </fieldset>
    </div>
  );
}
