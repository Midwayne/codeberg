import { DatasetSettings, HistorySettings } from './learning-datasets';
import { KnowledgeSettings } from './learning-knowledge';
import { Toggle } from './learning-controls';
import { useLearningSettingsPanel } from '../lib/use-learning-settings';
import { DreamingPanel } from './dreaming';

import { type LearningSettings } from '../lib/learning-settings';

import { ErrorNotice } from './ui';

export type LearningSettingsPanelProps = { onSaved?: () => void };

export function LearningSettingsPanel(props: LearningSettingsPanelProps) {
  const state = useLearningSettingsPanel(props);

  return <LearningSettingsPanelView {...state} />;
}

export type LearningSettingsPanelViewProps = ReturnType<typeof useLearningSettingsPanel>;

function LearningSettingsPanelView({
  project,
  error,
  settings,
  setRetry,
  busy,
  change,
  saved,
}: LearningSettingsPanelViewProps) {
  return (
    <section className="space-y-6" aria-labelledby="learning-settings-heading">
      <div className="space-y-2">
        <h2 id="learning-settings-heading" className="text-lg font-semibold">
          Learning
        </h2>
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">
          Choose what Codeberg remembers and reuses{project ? ` for ${project.name}` : ''}. Turn off background model
          calls or chat context to reduce token usage.
        </p>
      </div>
      <LearningSettingsError error={error} settings={settings} setRetry={setRetry} />
      <LearningSettingsLoading settings={settings} error={error} />
      {settings === null && (
        <p className="rounded-xl border border-border p-4 text-sm leading-6 text-muted-foreground">
          Learning is disabled by the launcher. Set CODEBERG_LEARNING_USE=true and restart Codeberg to configure its
          components here. Existing data is kept.
        </p>
      )}
      {settings && (
        <LearningSettingsView
          settings={settings}
          busy={busy}
          onChange={(next) => {
            void change(next);
          }}
        />
      )}
      {settings && <DreamingPanel key={project?.id ?? 'default'} enabled={settings.enabled && settings.knowledge} />}
      {settings && (
        <p role="status" className="min-h-5 text-xs text-muted-foreground">
          {busy
            ? 'Saving…'
            : saved
              ? 'Saved. Changes apply to new chat turns and background jobs.'
              : 'Changes save automatically for this project.'}
        </p>
      )}
    </section>
  );
}

export type LearningSettingsViewProps = {
  settings: LearningSettings;
  busy: boolean;
  onChange: (settings: LearningSettings) => void;
};

export function LearningSettingsView({ settings, busy, onChange }: LearningSettingsViewProps) {
  const locked = busy || !settings.enabled;
  const set = (key: keyof LearningSettings, value: boolean) => onChange({ ...settings, [key]: value });
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border px-4 sm:px-5">
        <Toggle
          label="Enable learning"
          description="Pause every component with one switch. Your individual choices are remembered."
          checked={settings.enabled}
          disabled={busy}
          onChange={(value) => set('enabled', value)}
        />
        <p className="border-t border-border py-3 text-xs leading-5 text-muted-foreground">
          {settings.enabled
            ? 'Existing data is kept when a component is turned off.'
            : 'Learning is paused. Existing data is kept; turn it back on to resume your selected components.'}{' '}
          A model request already running may finish.
        </p>
      </div>
      <div className="divide-y divide-border">
        <KnowledgeSettings settings={settings} locked={locked} set={set} onChange={onChange} />
        <HistorySettings settings={settings} locked={locked} set={set} />
        <DatasetSettings settings={settings} locked={locked} set={set} onChange={onChange} />
      </div>
    </div>
  );
}

export type LearningSettingsErrorProps = Pick<
  Parameters<typeof LearningSettingsPanelView>[0],
  'error' | 'settings' | 'setRetry'
>;

function LearningSettingsError({ error, settings, setRetry }: LearningSettingsErrorProps) {
  return (
    error &&
    (settings ? (
      <p role="alert" className="text-sm leading-6 text-destructive">
        Could not save learning settings. Your previous choices are restored. {error} Try the switch again.
      </p>
    ) : (
      <ErrorNotice
        title="Could not load learning settings"
        detail={error}
        onRetry={() => setRetry((value) => value + 1)}
      />
    ))
  );
}

export type LearningSettingsLoadingProps = Pick<Parameters<typeof LearningSettingsPanelView>[0], 'settings' | 'error'>;

function LearningSettingsLoading({ settings, error }: LearningSettingsLoadingProps) {
  return (
    settings === undefined &&
    !error && (
      <div role="status" className="space-y-4" aria-label="Loading learning settings">
        <div className="h-20 rounded-xl bg-muted" />
        <div className="h-40 rounded-xl bg-muted" />
        <span className="sr-only">Loading learning settings…</span>
      </div>
    )
  );
}
