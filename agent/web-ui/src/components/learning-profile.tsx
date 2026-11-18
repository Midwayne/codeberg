import { Toggle } from './learning-controls';

import type { LearningSettings } from '../lib/learning-settings';

type ProfileSettingsProps = {
  settings: LearningSettings;
  locked: boolean;
  set: (key: keyof LearningSettings, value: boolean) => void;
};

export function ProfileSettings({ settings, locked, set }: ProfileSettingsProps) {
  return (
    <div className="pb-5">
      <Toggle
        label="Learn how you work"
        description="Ask the agent to remember or forget something, and learn from the reasons you give with ratings: preferences, definitions, ongoing work and where things live. Chats follow them. Notes from rating reasons need Record chats and feedback."
        impact="Model call per rating reason · adds chat context"
        checked={settings.profile}
        disabled={locked}
        onChange={(value) => set('profile', value)}
      />
    </div>
  );
}
