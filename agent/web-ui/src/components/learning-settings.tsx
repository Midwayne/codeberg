import { DreamingPanel } from '@/components/dreaming';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { KNOWLEDGE_CATEGORIES, DATASET_KINDS } from '@agent/core/learning/preferences';
import { loadLearningSettings, saveLearningSettings, type LearningSettings } from '@/lib/learning-settings';
import { useProjectApi } from '@/lib/project-api';
import { KIND_LABELS } from '@/lib/training';
import { ErrorNotice } from '@/components/ui';

const categoryLabels = { services: 'Services', flows: 'Flows', concepts: 'Concepts', debugging: 'Debugging' };

export function LearningSettingsPanel({ onSaved }: { onSaved?: () => void }) {
  const { fetch: api, project } = useProjectApi();
  const [settings, setSettings] = useState<LearningSettings | null>();
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    let current = true;
    setError('');
    void loadLearningSettings(api).then((value) => { if (current) setSettings(value); })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { current = false; active.current = false; };
  }, [api, retry]);
  const change = async (next: LearningSettings) => {
    if (saving.current || !settings) return;
    const previous = settings;
    saving.current = true; setBusy(true); setError(''); setSaved(false); setSettings(next);
    try {
      const value = await saveLearningSettings(next, api);
      if (active.current) { setSettings(value); setSaved(true); onSaved?.(); }
    } catch (reason) {
      if (active.current) { setSettings(previous); setError(reason instanceof Error ? reason.message : String(reason)); }
    } finally {
      saving.current = false;
      if (active.current) setBusy(false);
    }
  };
  return <section className="space-y-6" aria-labelledby="learning-settings-heading">
    <div className="space-y-2">
      <h2 id="learning-settings-heading" className="text-lg font-semibold">Learning</h2>
      <p className="max-w-prose text-sm leading-6 text-muted-foreground">Choose what Codeberg remembers and reuses{project ? ` for ${project.name}` : ''}. Turn off background model calls or chat context to reduce token usage.</p>
    </div>
    {error && (settings ? <p role="alert" className="text-sm leading-6 text-destructive">Could not save learning settings. Your previous choices are restored. {error} Try the switch again.</p> : <ErrorNotice title="Could not load learning settings" detail={error} onRetry={() => setRetry((value) => value + 1)} />)}
    {settings === undefined && !error && <div role="status" className="space-y-4" aria-label="Loading learning settings"><div className="h-20 rounded-xl bg-muted" /><div className="h-40 rounded-xl bg-muted" /><span className="sr-only">Loading learning settings…</span></div>}
    {settings === null && <p className="rounded-xl border border-border p-4 text-sm leading-6 text-muted-foreground">Learning is disabled by the launcher. Set CODEBERG_LEARNING_USE=true and restart Codeberg to configure its components here. Existing data is kept.</p>}
    {settings && <LearningSettingsView settings={settings} busy={busy} onChange={(next) => { void change(next); }} />}
    {settings && <DreamingPanel key={project?.id ?? 'default'} enabled={settings.enabled && settings.knowledge} />}
    {settings && <p role="status" className="min-h-5 text-xs text-muted-foreground">{busy ? 'Saving…' : saved ? 'Saved. Changes apply to new chat turns and background jobs.' : 'Changes save automatically for this project.'}</p>}
  </section>;
}

export function LearningSettingsView({ settings, busy, onChange }: { settings: LearningSettings; busy: boolean; onChange: (settings: LearningSettings) => void }) {
  const locked = busy || !settings.enabled;
  const set = (key: keyof LearningSettings, value: boolean) => onChange({ ...settings, [key]: value });
  return <div className="space-y-6">
    <div className="rounded-xl border border-border px-4 sm:px-5">
      <Toggle label="Enable learning" description="Pause every component with one switch. Your individual choices are remembered." checked={settings.enabled} disabled={busy} onChange={(value) => set('enabled', value)} />
      <p className="border-t border-border py-3 text-xs leading-5 text-muted-foreground">{settings.enabled ? 'Existing data is kept when a component is turned off.' : 'Learning is paused. Existing data is kept; turn it back on to resume your selected components.'} A model request already running may finish.</p>
    </div>
    <div className="divide-y divide-border">
      <div className="pb-5">
        <Toggle label="Codebase knowledge" description="Save and reuse source-backed findings from solved investigations." impact="Background model calls" checked={settings.knowledge} disabled={locked} onChange={(value) => set('knowledge', value)} />
        <fieldset disabled={locked || !settings.knowledge} className="min-w-0 pl-4 sm:pl-5">
          <legend className="sr-only">Knowledge components</legend>
          <Toggle label="Learn from solved answers" description="Call the learning model to create knowledge from new solved feedback." checked={settings.knowledgeCapture} disabled={locked || !settings.knowledge} onChange={(value) => set('knowledgeCapture', value)} small />
          <Toggle label="Use knowledge in chats" description="Let the agent search saved findings. Results add context tokens when used." checked={settings.knowledgeRecall} disabled={locked || !settings.knowledge} onChange={(value) => set('knowledgeRecall', value)} small />
          <Toggle label="Automatic source refresh" description="Recheck saved findings when their source changes. Refreshes can call the learning model." checked={settings.knowledgeRefresh} disabled={locked || !settings.knowledge} onChange={(value) => set('knowledgeRefresh', value)} small />
          <Toggle label="Daily knowledge consolidation" description="Generate one reviewable report each day while Codeberg is running. Reports are applied only when you choose Apply report." checked={settings.dreaming} disabled={locked || !settings.knowledge} onChange={(value) => set('dreaming', value)} small />
          <Components label="Knowledge categories" disabled={locked || !settings.knowledge}>
            {KNOWLEDGE_CATEGORIES.map((key) => <Toggle key={key} label={categoryLabels[key]} checked={settings.categories[key]} disabled={locked || !settings.knowledge} onChange={(value) => onChange({ ...settings, categories: { ...settings.categories, [key]: value } })} small />)}
          </Components>
        </fieldset>
      </div>
      <div className="py-5">
        <Toggle label="Learning history" description="Keep previous investigations available as local learning context." impact="No model calls to record" checked={settings.history} disabled={locked} onChange={(value) => set('history', value)} />
        <div className="pl-4 sm:pl-5"><Toggle label="Record chats and feedback" description="Save answers, tool results, corrections, and ratings locally. Turn off to stop new collection." checked={settings.historyCapture} disabled={locked || !settings.history} onChange={(value) => set('historyCapture', value)} small /><Toggle label="Use history in chats" description="Search earlier attempts and feedback. Retrieved history adds context tokens." checked={settings.historyRecall} disabled={locked || !settings.history} onChange={(value) => set('historyRecall', value)} small /></div>
        {(!settings.history || !settings.historyCapture) && <p className="pl-4 text-xs leading-5 text-muted-foreground sm:pl-5">New knowledge and dataset capture need recorded history. Existing queued work can still run.</p>}
      </div>
      <div className="pt-5">
        <Toggle label="Dataset capture" description="Derive reviewable examples from recorded answers and feedback." impact="No model calls" checked={settings.datasets} disabled={locked} onChange={(value) => set('datasets', value)} />
        <fieldset disabled={locked || !settings.datasets} className="min-w-0 pl-4 sm:pl-5">
          <legend className="sr-only">Dataset components</legend>
          <Toggle label="Training review" description="Allow reviewed examples to be approved for future training exports." checked={settings.training} disabled={locked || !settings.datasets} onChange={(value) => set('training', value)} small />
          <Toggle label="Evaluations" description="Allow independently checked examples to be saved as held-out test cases. No model calls." checked={settings.evals} disabled={locked || !settings.datasets} onChange={(value) => set('evals', value)} small />
          <Components label="Example types" disabled={locked || !settings.datasets}>
            {DATASET_KINDS.map((key) => <Toggle key={key} label={KIND_LABELS[key]} checked={settings.kinds[key]} disabled={locked || !settings.datasets} onChange={(value) => onChange({ ...settings, kinds: { ...settings.kinds, [key]: value } })} small />)}
          </Components>
        </fieldset>
      </div>
    </div>
  </div>;
}

function Components({ label, disabled, children }: { label: string; disabled: boolean; children: ReactNode }) {
  return <details className="mt-2 border-t border-border">
    <summary className={`min-h-11 cursor-pointer py-3 text-sm ${disabled ? 'text-muted-foreground' : 'text-foreground'}`}>{label}</summary>
    <div className="grid gap-x-6 sm:grid-cols-2">{children}</div>
  </details>;
}

function Toggle({ label, description, impact, checked, disabled, onChange, small = false }: { label: string; description?: string; impact?: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void; small?: boolean }) {
  const id = useId();
  return <label className="flex min-h-11 cursor-pointer items-start justify-between gap-4 py-3 has-disabled:cursor-default">
    <span className="min-w-0">
      <span className={`block text-sm ${small ? '' : 'font-medium'}`}>{label}</span>
      {description && <span id={id} className="mt-1 block max-w-prose text-sm leading-6 text-muted-foreground">{description}</span>}
      {impact && <span className="mt-2 block text-xs font-medium text-muted-foreground">{impact}</span>}
    </span>
    <input type="checkbox" role="switch" checked={checked} disabled={disabled} aria-label={label} aria-checked={checked} aria-describedby={description ? id : undefined} onChange={(event) => onChange(event.currentTarget.checked)} className="mt-0.5 size-5 shrink-0 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:cursor-default disabled:opacity-50" />
  </label>;
}
