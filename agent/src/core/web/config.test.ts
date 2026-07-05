import { describe, expect, it } from 'vitest';

import { webConfigFromEnv } from './config.js';

describe('webConfigFromEnv', () => {
  it('enables web use by default with sensible limits', () => {
    const c = webConfigFromEnv({});
    expect(c.enabled).toBe(true);
    expect(c.searxngUrl).toBe('');
    expect(c.allowPrivate).toBe(false);
    expect(c.maxBytes).toBeGreaterThan(0);
    expect(c.maxChars).toBeGreaterThan(0);
    expect(c.timeoutMs).toBeGreaterThan(0);
    expect(c.searchCount).toBeGreaterThan(0);
  });

  it('treats 0/false/off/no (any case) as disabled', () => {
    for (const v of ['0', 'false', 'off', 'No', 'FALSE']) {
      expect(webConfigFromEnv({ CODEBERG_WEB_USE: v }).enabled).toBe(false);
    }
    expect(webConfigFromEnv({ CODEBERG_WEB_USE: '1' }).enabled).toBe(true);
    expect(webConfigFromEnv({ CODEBERG_WEB_USE: 'yes' }).enabled).toBe(true);
  });

  it('normalizes the SearXNG URL (trim + strip trailing slash)', () => {
    expect(webConfigFromEnv({ CODEBERG_SEARXNG_URL: '  http://sx:8888/  ' }).searxngUrl).toBe(
      'http://sx:8888',
    );
  });

  it('honours numeric overrides and ignores junk', () => {
    const c = webConfigFromEnv({
      CODEBERG_WEB_MAX_CHARS: '1234',
      CODEBERG_WEB_TIMEOUT_MS: 'abc',
      CODEBERG_WEB_ALLOW_PRIVATE: '1',
    });
    expect(c.maxChars).toBe(1234);
    expect(c.timeoutMs).toBeGreaterThan(0); // junk falls back to default
    expect(c.allowPrivate).toBe(true);
  });
});
