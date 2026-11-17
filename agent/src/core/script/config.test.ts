import { describe, expect, it } from 'vitest';

import { scriptConfig, scriptTimeoutMs } from './config.js';

describe('scriptConfig', () => {
  it('is off unless explicitly enabled', () => {
    expect(scriptConfig({})).toBeUndefined();
    expect(scriptConfig({ CODEBERG_SCRIPT_USE: 'false' })).toBeUndefined();
  });

  it('uses the configured interpreter', () => {
    const config = scriptConfig({ CODEBERG_SCRIPT_USE: 'true', CODEBERG_SCRIPT_PYTHON: '/opt/py/bin/python3' });

    expect(config?.python).toBe('/opt/py/bin/python3');
  });
});

describe('scriptTimeoutMs', () => {
  it('defaults and clamps the timeout', () => {
    expect(scriptTimeoutMs(undefined)).toBe(60_000);
    expect(scriptTimeoutMs(0)).toBe(1_000);
    expect(scriptTimeoutMs(10_000)).toBe(300_000);
  });
});
