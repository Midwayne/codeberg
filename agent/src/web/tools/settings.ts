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

      return { CODEBERG_WEB_SEARCH_USE: String(settings.webSearch), CODEBERG_SEARXNG_URL: url };
    }).catch(() => ({ CODEBERG_WEB_SEARCH_USE: 'false', CODEBERG_SEARXNG_URL: '' }));
  }

  update(input: unknown): Promise<ToolSettings> {
    return this.serialize(async () => {
      const webSearch = (input as { webSearch?: unknown } | null)?.webSearch;
      if (typeof webSearch !== 'boolean') throw new ToolSettingsError('webSearch must be a boolean.');
      if (webSearch && !webConfigFromEnv(this.env).enabled)
        throw new ToolSettingsError('Web access is disabled by CODEBERG_WEB_USE=false.');

      await writeJsonAtomic(this.path, { webSearch });

      return (await this.snapshot()).settings;
    });
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.writing.then(action);
    this.writing = pending.catch(() => undefined);

    return pending;
  }

  private async preference(): Promise<boolean> {
    try {
      const stored = JSON.parse(await readFile(this.path, 'utf8'));
      if (typeof stored?.webSearch !== 'boolean') throw new SyntaxError('Invalid tool settings.');

      return stored.webSearch;
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new Error('Saved tool settings are invalid. Open the config directory, repair or remove tool-settings.json, and retry.');
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;

      return webConfigFromEnv(this.env).searchEnabled;
    }
  }

  private async snapshot(): Promise<{ settings: ToolSettings; url: string }> {
    const config = webConfigFromEnv(this.env);
    const webSearch = config.enabled && await this.preference();
    const managed = Boolean(this.env.CODEBERG_SEARCH_CONTROL_URL);
    const provider = config.searxngUrl ? 'external' : managed ? 'managed' : 'unavailable';
    const worker = managed ? await this.control(webSearch && provider === 'managed') : undefined;
    const status = !webSearch ? 'disabled' : provider === 'external' ? 'ready' : worker?.status ?? 'unavailable';
    const url = status === 'ready' ? config.searxngUrl || worker?.url || '' : '';

    return { settings: { webSearch, allowed: config.enabled, provider, status,
      message: !config.enabled ? 'Web access is disabled by CODEBERG_WEB_USE=false.' : worker?.message }, url };
  }

  private async control(enabled: boolean): Promise<SearchStatus> {
    const response = await this.fetch(this.env.CODEBERG_SEARCH_CONTROL_URL!, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.env.CODEBERG_SEARCH_CONTROL_TOKEN ?? ''}` },
      body: JSON.stringify({ enabled }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error('Web search service unavailable. Restart Codeberg and retry.');

    return validateSearchStatus(await response.json(), enabled);
  }
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
