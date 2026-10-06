import { Components, Toggle } from './learning-controls';

import { KNOWLEDGE_CATEGORIES } from '@agent/core/learning/preferences';
import { type LearningSettings } from '../lib/learning-settings';

import { type LearningSettingsView } from './learning-settings';

export const categoryLabels = { services: 'Services', flows: 'Flows', concepts: 'Concepts', debugging: 'Debugging' };

export type KnowledgeSettingsProps = Pick<Parameters<typeof LearningSettingsView>[0], 'settings' | 'onChange'> & {
  locked: boolean;
  set: (key: keyof LearningSettings, value: boolean) => void;
};

export function KnowledgeSettings({ settings, locked, set, onChange }: KnowledgeSettingsProps) {
  return (
    <div className="pb-5">
      <Toggle
        label="Codebase knowledge"
        description="Save and reuse source-backed findings from solved investigations."
        impact="Background model calls"
        checked={settings.knowledge}
        disabled={locked}
        onChange={(value) => set('knowledge', value)}
      />
      <fieldset disabled={locked || !settings.knowledge} className="min-w-0 pl-4 sm:pl-5">
        <legend className="sr-only">Knowledge components</legend>
        <Toggle
          label="Learn from solved answers"
          description="Call the learning model to create knowledge from new solved feedback."
          checked={settings.knowledgeCapture}
          disabled={locked || !settings.knowledge}
          onChange={(value) => set('knowledgeCapture', value)}
          small
        />
        <Toggle
          label="Use knowledge in chats"
          description="Let the agent search saved findings. Results add context tokens when used."
          checked={settings.knowledgeRecall}
          disabled={locked || !settings.knowledge}
          onChange={(value) => set('knowledgeRecall', value)}
          small
        />
        <Toggle
          label="Automatic source refresh"
          description="Recheck saved findings when their source changes. Refreshes can call the learning model."
          checked={settings.knowledgeRefresh}
          disabled={locked || !settings.knowledge}
          onChange={(value) => set('knowledgeRefresh', value)}
          small
        />
        <Toggle
          label="Daily knowledge consolidation"
          description="Generate one reviewable report each day while Codeberg is running. Reports are applied only when you choose Apply report."
          checked={settings.dreaming}
          disabled={locked || !settings.knowledge}
          onChange={(value) => set('dreaming', value)}
          small
        />
        <KnowledgeCategories locked={locked} settings={settings} onChange={onChange} />
      </fieldset>
    </div>
  );
}

export type KnowledgeCategoriesProps = Pick<
  Parameters<typeof KnowledgeSettings>[0],
  'locked' | 'settings' | 'onChange'
>;

export function KnowledgeCategories({ locked, settings, onChange }: KnowledgeCategoriesProps) {
  return (
    <Components label="Knowledge categories" disabled={locked || !settings.knowledge}>
      {KNOWLEDGE_CATEGORIES.map((key) => (
        <Toggle
          key={key}
          label={categoryLabels[key]}
          checked={settings.categories[key]}
          disabled={locked || !settings.knowledge}
          onChange={(value) => onChange({ ...settings, categories: { ...settings.categories, [key]: value } })}
          small
        />
      ))}
    </Components>
  );
}
