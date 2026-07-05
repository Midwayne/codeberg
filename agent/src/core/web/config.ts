import type { WebConfig } from './types.js';

const DEFAULT_MAX_BYTES = 1_500_000; // 1.5 MB raw body cap
const DEFAULT_MAX_CHARS = 20_000; // ~5k tokens of extracted text
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_SEARCH_COUNT = 6;

/** A flag env var: anything but 0/false/off/no (case-insensitive) is "on". */
function flag(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === '') return fallback;
  return !/^(0|false|off|no)$/i.test(value.trim());
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Resolve the agent's web configuration from the environment.
 *
 * - `CODEBERG_WEB_USE` — master switch, **on by default**; set 0/false/off to disable.
 * - `CODEBERG_SEARXNG_URL` — SearXNG base URL that backs `web_search` (no key needed).
 * - `CODEBERG_WEB_ALLOW_PRIVATE` — allow fetching localhost/private hosts (default off).
 * - `CODEBERG_WEB_MAX_BYTES` / `CODEBERG_WEB_MAX_CHARS` / `CODEBERG_WEB_TIMEOUT_MS` /
 *   `CODEBERG_WEB_SEARCH_COUNT` — tuning knobs with sensible defaults.
 */
export function webConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WebConfig {
  return {
    enabled: flag(env.CODEBERG_WEB_USE, true),
    searxngUrl: (env.CODEBERG_SEARXNG_URL ?? '').trim().replace(/\/+$/, ''),
    maxBytes: positiveInt(env.CODEBERG_WEB_MAX_BYTES, DEFAULT_MAX_BYTES),
    maxChars: positiveInt(env.CODEBERG_WEB_MAX_CHARS, DEFAULT_MAX_CHARS),
    timeoutMs: positiveInt(env.CODEBERG_WEB_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    searchCount: positiveInt(env.CODEBERG_WEB_SEARCH_COUNT, DEFAULT_SEARCH_COUNT),
    allowPrivate: flag(env.CODEBERG_WEB_ALLOW_PRIVATE, false),
  };
}
