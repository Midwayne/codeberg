import { describe, expect, it } from 'vitest';

import { DEFAULT_DAEMON_URL } from './client.js';
import { entryUsage, parseEntryArgs } from './entry.js';

describe('parseEntryArgs', () => {
  it('parses model and question from argv', () => {
    const entry = parseEntryArgs(
      ['node', 'cli', 'openai:gpt-4o-mini', 'how', 'does', 'auth', 'work'],
      {},
    );
    expect(entry).toEqual({
      modelSpec: 'openai:gpt-4o-mini',
      subagentModelSpec: 'openai:gpt-4o-mini',
      question: 'how does auth work',
      daemonUrl: DEFAULT_DAEMON_URL,
    });
  });

  it('honors env overrides', () => {
    const entry = parseEntryArgs(['node', 'cli', 'anthropic:claude'], {
      CODEBERG_MODEL: 'openai:gpt-4o',
      CODEBERG_QUESTION: 'from env',
      CODEBERG_DAEMON_URL: 'http://localhost:9000',
    });
    expect(entry?.modelSpec).toBe('openai:gpt-4o');
    expect(entry?.subagentModelSpec).toBe('openai:gpt-4o');
    expect(entry?.question).toBe('from env');
    expect(entry?.daemonUrl).toBe('http://localhost:9000');
  });

  it('supports an independent subagent model', () => {
    const entry = parseEntryArgs(['node', 'cli'], {
      CODEBERG_MODEL: 'openai:gpt-4o',
      CODEBERG_SUBAGENT_MODEL: 'anthropic:claude-haiku',
    });
    expect(entry?.subagentModelSpec).toBe('anthropic:claude-haiku');
  });

  it('returns null without model spec', () => {
    expect(parseEntryArgs(['node', 'cli'], {})).toBeNull();
  });

  it('includes program name in usage', () => {
    expect(entryUsage('codeberg-web')).toContain('codeberg-web');
  });
});
