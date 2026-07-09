import { normalizeSearchHit } from './search-hit.js';
import type { SearchOptions, SearchResult, ToolSpec } from './types.js';

/** Default daemon HTTP port (launcher / `codeberg` default; standalone codeberg-d uses 8080). */
export const DEFAULT_DAEMON_PORT = 48080;

/** Default daemon base URL when CODEBERG_DAEMON_URL is unset. */
export const DEFAULT_DAEMON_URL = `http://127.0.0.1:${DEFAULT_DAEMON_PORT}`;

export interface DaemonHealth {
  ready: boolean;
  chunks: number;
  version: string;
  vectors_enabled: boolean;
  repos?: { key: string; ready: boolean; chunks: number }[];
}

export interface DaemonErrorBody {
  ok: false;
  code: string;
  message: string;
}

export class DaemonError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DaemonError';
  }
}

export class DaemonClient {
  constructor(private readonly baseUrl: string) {}

  async health(): Promise<DaemonHealth> {
    const res = await fetch(new URL('/health', this.baseUrl));
    const body = (await res.json()) as DaemonHealth & DaemonErrorBody;
    if (!res.ok) {
      throw parseError(res.status, body);
    }
    return body;
  }

  /** Poll /health until the indexer is ready or timeoutMs elapses. */
  async waitReady(timeoutMs = 60_000): Promise<DaemonHealth> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const h = await this.health();
      if (h.ready) {
        return h;
      }
      await sleep(250);
    }
    throw new DaemonError('NOT_READY', 'daemon indexer not ready', 503);
  }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const url = new URL('/search', this.baseUrl);
    url.searchParams.set('q', query);
    if (opts.k != null) {
      url.searchParams.set('k', String(opts.k));
    }
    if (opts.repo) {
      url.searchParams.set('repo', opts.repo);
    }
    if (opts.path_glob) {
      url.searchParams.set('path_glob', opts.path_glob);
    }
    if (opts.kind) {
      url.searchParams.set('kind', opts.kind);
    }
    if (opts.min_score != null) {
      url.searchParams.set('min_score', String(opts.min_score));
    }
    const res = await fetch(url);
    const body = (await res.json()) as {
      results: SearchResult[];
    } & DaemonErrorBody;
    if (!res.ok) {
      throw parseError(res.status, body);
    }
    return body.results
      .map((r) => normalizeSearchHit(r))
      .filter((r): r is SearchResult => r != null);
  }

  async listTools(): Promise<ToolSpec[]> {
    const res = await fetch(new URL('/tools', this.baseUrl));
    const body = (await res.json()) as {
      tools: {
        name: string;
        description: string;
        schema: Record<string, unknown>;
      }[];
    } & DaemonErrorBody;
    if (!res.ok) {
      throw parseError(res.status, body);
    }
    return body.tools.map((t) => ({
      name: t.name,
      description: t.description,
      schema: t.schema,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(new URL('/tools/call', this.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, args }),
    });
    const body = (await res.json()) as { result: unknown } & DaemonErrorBody;
    if (!res.ok) {
      throw parseError(res.status, body);
    }
    return body.result;
  }
}

function parseError(status: number, body: DaemonErrorBody | { message?: string }): DaemonError {
  if ('code' in body && body.code) {
    return new DaemonError(body.code, body.message, status);
  }
  return new DaemonError('DAEMON_ERROR', String(body.message ?? status), status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
