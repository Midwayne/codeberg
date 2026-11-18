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
        description="Ask the agent to remember or forget something, and after each answer and rating it notes reusable preferences, conventions, ongoing decisions and where things live. Chats follow them. Automatic notes need Record chats and feedback."
        impact="Background model calls · adds chat context"
        checked={settings.profile}
        disabled={locked}
        onChange={(value) => set('profile', value)}
      />
    </div>
  );
}
