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
  it('has no timeout unless one is requested', () => {
    expect(scriptTimeoutMs(undefined)).toBeUndefined();
    expect(scriptTimeoutMs(0)).toBeUndefined();
    expect(scriptTimeoutMs(0.2)).toBe(1_000);
    expect(scriptTimeoutMs(86_400)).toBe(86_400_000);
  });
});
