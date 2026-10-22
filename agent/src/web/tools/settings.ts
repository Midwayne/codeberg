import { browserEnabled, browserVisionEnabled } from '../../core/browser/config.js';
import { cancelBrowserTasks } from '../../core/browser/runner.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from '../../core/learning/fs.js';
import { codebergHome } from '../../core/paths.js';
import { webConfigFromEnv } from '../../core/web/config.js';
import type { ToolSettings } from '../../core/web/types.js';

type SearchStatus = { status: 'disabled' | 'starting' | 'ready' | 'error'; url?: string; message?: string };

export class ToolSettingsError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** One global preference; no model or selected project is required. */
export class ToolSettingsStore {
  private readonly env: NodeJS.ProcessEnv;
  private readonly path: string;
  private readonly fetch: typeof fetch;
  private writing: Promise<unknown> = Promise.resolve();

  constructor(options: { home?: string; env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}) {
    this.env = options.env ?? process.env;
    this.path = join(options.home ?? codebergHome(this.env), 'tool-settings.json');
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  current(): Promise<ToolSettings> {
    return this.serialize(async () => (await this.snapshot()).settings);
  }

  environment(): Promise<NodeJS.ProcessEnv> {
    return this.serialize(async () => {
      const { settings, url } = await this.snapshot();

      return { CODEBERG_WEB_SEARCH_USE: String(settings.webSearch && settings.status === 'ready'), CODEBERG_SEARXNG_URL: url,
        CODEBERG_BROWSER_USE: String(settings.browserUse), CODEBERG_BROWSER_VISION: String(settings.browserVision),
        CODEBERG_BROWSER_SETTINGS_PATH: this.path };
    }).catch(() => ({ CODEBERG_WEB_SEARCH_USE: 'false', CODEBERG_SEARXNG_URL: '',
      CODEBERG_BROWSER_USE: 'false', CODEBERG_BROWSER_VISION: 'false', CODEBERG_BROWSER_SETTINGS_PATH: this.path }));
  }

  update(input: unknown): Promise<ToolSettings> {
    return this.serialize(async () => {
      const values = input as { webSearch?: unknown; browserUse?: unknown; browserVision?: unknown } | null;
      if (!values || typeof values !== 'object' || Array.isArray(values) ||
        (values.webSearch === undefined && values.browserUse === undefined && values.browserVision === undefined))
        throw new ToolSettingsError('Provide webSearch, browserUse, or browserVision as a boolean.');
      for (const key of ['webSearch', 'browserUse', 'browserVision'] as const) {
        if (values[key] !== undefined && typeof values[key] !== 'boolean')
          throw new ToolSettingsError(`${key} must be a boolean.`);
      }
      if ((values.webSearch === true || values.browserUse === true || values.browserVision === true) && !webConfigFromEnv(this.env).enabled)
        throw new ToolSettingsError('Web access is disabled by CODEBERG_WEB_USE=false.');

      const previous = await this.preference().catch((error) => {
        if (values.webSearch !== false && values.browserUse !== false && values.browserVision !== false) throw error;

        return { webSearch: false, browserUse: false, browserVision: false };
      });
      const webSearch = values.webSearch === undefined ? previous.webSearch : values.webSearch;
      const browserUse = values.browserUse === undefined ? previous.browserUse : values.browserUse;
      const browserVision = values.browserVision === undefined ? previous.browserVision : values.browserVision;
      await writeJsonAtomic(this.path, { webSearch, browserUse, browserVision });
      if (!browserUse) await cancelBrowserTasks(this.path);

      return (await this.snapshot()).settings;
    });
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.writing.then(action);
    this.writing = pending.catch(() => undefined);

    return pending;
  }

  private async preference(): Promise<{ webSearch: boolean; browserUse: boolean; browserVision: boolean }> {
    try {
      const stored = JSON.parse(await readFile(this.path, 'utf8'));
      if (typeof stored?.webSearch !== 'boolean' ||
        (stored.browserUse !== undefined && typeof stored.browserUse !== 'boolean') ||
        (stored.browserVision !== undefined && typeof stored.browserVision !== 'boolean')) throw new SyntaxError('Invalid tool settings.');

      return { webSearch: stored.webSearch, browserUse: stored.browserUse ?? browserEnabled(this.env),
        browserVision: stored.browserVision ?? browserVisionEnabled(this.env) };
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new Error('Saved tool settings are invalid. Open the config directory, repair or remove tool-settings.json, and retry.');
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;

      return { webSearch: webConfigFromEnv(this.env).searchEnabled, browserUse: browserEnabled(this.env),
        browserVision: browserVisionEnabled(this.env) };
    }
  }

  private async snapshot(): Promise<{ settings: ToolSettings; url: string }> {
    const config = webConfigFromEnv(this.env);
    const preferences = await this.preference();
    const webSearch = config.enabled && preferences.webSearch;
    const browserUse = config.enabled && preferences.browserUse;
    const managed = Boolean(this.env.CODEBERG_SEARCH_CONTROL_URL);
    const provider = config.searxngUrl ? 'external' : managed ? 'managed' : 'unavailable';
    const worker = managed ? await this.control(webSearch && provider === 'managed').catch(searchControlError) : undefined;
    const controlFailed = worker?.status === 'error' && (!webSearch || provider === 'managed');
    const status = controlFailed ? 'error' : !webSearch ? 'disabled'
      : provider === 'external' ? 'ready' : worker?.status ?? 'unavailable';
    const url = status === 'ready' ? config.searxngUrl || worker?.url || '' : '';

    return { settings: { webSearch, browserUse, browserVision: preferences.browserVision, allowed: config.enabled, provider, status,
      message: !config.enabled ? 'Web access is disabled by CODEBERG_WEB_USE=false.' : worker?.message }, url };
  }

  private async control(enabled: boolean): Promise<SearchStatus> {
    const response = await this.fetch(this.env.CODEBERG_SEARCH_CONTROL_URL!, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.env.CODEBERG_SEARCH_CONTROL_TOKEN ?? ''}` },
      body: JSON.stringify({ enabled }),
      // Leave time for the settings response before the UI's 20-second deadline.
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Web search service unavailable. Restart Codeberg and retry.');

    return validateSearchStatus(await response.json(), enabled);
  }
}

function searchControlError(error: unknown): SearchStatus {
  return { status: 'error', message: error instanceof Error ? error.message : 'Web search service unavailable. Restart Codeberg and retry.' };
}

function validateSearchStatus(value: unknown, enabled: boolean): SearchStatus {
  const input = value as Partial<SearchStatus> | null;
  if (!input || typeof input !== 'object' || !['disabled', 'starting', 'ready', 'error'].includes(input.status ?? '') ||
    (input.message !== undefined && typeof input.message !== 'string') ||
    (input.url !== undefined && typeof input.url !== 'string'))
    throw new Error('Invalid web search service response. Restart Codeberg and retry.');

  if (!enabled && input.status !== 'disabled') throw new Error('Web search service did not stop. Retry.');
  if (input.status === 'ready' && !isManagedEndpoint(input.url))
    throw new Error('Invalid web search service endpoint. Restart Codeberg and retry.');

  return input as SearchStatus;
}

function isManagedEndpoint(value: string | undefined): boolean {
  if (!value) return false;

  try {
    const url = new URL(value);

    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password;
  } catch {
    return false;
  }
}
