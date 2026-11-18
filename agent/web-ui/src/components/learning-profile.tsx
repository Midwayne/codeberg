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
        description="After each answer and rating, note reusable preferences you showed, such as answer style, tools and conventions. Chats follow them. Needs Record chats and feedback."
        impact="Background model calls · adds chat context"
        checked={settings.profile}
        disabled={locked}
        onChange={(value) => set('profile', value)}
      />
    </div>
  );
}
