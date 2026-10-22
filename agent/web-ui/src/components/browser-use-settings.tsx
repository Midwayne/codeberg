import type { ToolSettings } from '@agent/core/web/types.js';
import type { useToolSettings } from '../lib/use-tool-settings';
import { Toggle } from './learning-controls';

export function BrowserUseSettings({ settings, busy, change }: {
  settings: ToolSettings;
  busy: boolean;
  change: ReturnType<typeof useToolSettings>['change'];
}) {
  return (
    <div className="space-y-3 border-t border-border pt-6">
      <Toggle label="Browser Use" description="Let Codeberg delegate browser tasks to a separate local agent. Off by default."
        checked={settings.browserUse} disabled={busy || !settings.allowed}
        onChange={(value) => void change({ browserUse: value })} />
      <p className="max-w-prose text-sm leading-6 text-muted-foreground">
        Starts a local browser only when the agent delegates a task, and closes it by default.
        Ask to leave the browser open to inspect the tabs or continue in it later.
        Turning this off cancels active browser tasks and closes retained browsers. Actions already completed may have taken effect.
      </p>
      <Toggle label="Browser vision" description="Allow the browser agent to use screenshots. Off by default."
        checked={settings.browserVision} disabled={busy || !settings.allowed}
        onChange={(value) => void change({ browserVision: value })} />
      <p className="max-w-prose text-sm leading-6 text-muted-foreground">
        Browser Use requires a model marked with vision input support in models.yml, even when screenshots are off.
        Vision changes apply to the next browser task, including tasks in retained browsers. An active task keeps its current setting.
      </p>
      <p className="max-w-prose text-sm leading-6 text-muted-foreground">
        Requires uv and Chrome or Chromium on the machine running Codeberg. First use downloads the Python runtime
        and Browser Use package. Uses your chat model unless a browser model is configured; provider usage is billed separately.
        New sessions use a fresh browser profile; retained sessions reuse their tabs and logins.
        {' '}<a href="/docs/tools#browser-use-delegation" className="underline underline-offset-4">Browser Use setup</a>
      </p>
    </div>
  );
}
