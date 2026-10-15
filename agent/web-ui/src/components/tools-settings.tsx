import type { ToolSettings } from '@agent/core/web/types.js';
import { useToolSettings } from '../lib/use-tool-settings';
import { LoadingBoundary } from './loading';
import { Toggle } from './learning-controls';

export function ToolsSettings() {
  return <ToolsSettingsView {...useToolSettings()} />;
}

export function ToolsSettingsView({ settings, busy, error, refresh, change }: ReturnType<typeof useToolSettings>) {
  return (
    <section className="space-y-6" aria-labelledby="tools-settings-heading">
      <div className="space-y-2">
        <h2 id="tools-settings-heading" className="text-lg font-semibold">Tools</h2>
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">
          Choose optional tools for the agent. These settings apply to all projects.
        </p>
      </div>
      {error && <div role="alert" className="text-sm text-destructive">{error}{' '}
        <button className="underline underline-offset-4" onClick={() => void refresh()}>Retry</button>
      </div>}
      <LoadingBoundary loading={!settings && !error} label="Loading tool settings…" kind="control">
        {settings && <div className="space-y-4">
          <Toggle label="Web search" description="Let the agent search the public web for documentation and answers. Off by default."
            checked={settings.webSearch} disabled={busy || !settings.allowed} onChange={(value) => void change(value)} />
          <p className="max-w-prose text-sm leading-6 text-muted-foreground">
            Turning this off stops the local search service and cancels setup in progress.
            Direct URL fetching and code search remain available. An external search service is managed separately.
          </p>
          <SearchServiceStatus settings={settings} />
        </div>}
      </LoadingBoundary>
      <p role="status" className="text-xs text-muted-foreground">{busy ? 'Saving…' : 'Changes save automatically for all projects.'}</p>
    </section>
  );
}

function SearchServiceStatus({ settings }: { settings: ToolSettings }) {
  const messages = {
    disabled: 'Web search is off. The local search service is stopped.',
    starting: 'Setting up web search… First setup can take several minutes. You can turn it off to cancel.',
    ready: settings.provider === 'external' ? 'Web search uses your external search service.' : 'Web search is ready.',
    error: 'Web search could not start. Turn it off and on to retry.',
    unavailable: 'Start Codeberg with the launcher for local web search, or configure an external SearXNG service and restart.',
  };

  return <p role={settings.status === 'error' ? 'alert' : 'status'} className="max-w-prose text-sm leading-6 text-muted-foreground">
    {messages[settings.status]}{settings.message && ` ${settings.message}`}
  </p>;
}
