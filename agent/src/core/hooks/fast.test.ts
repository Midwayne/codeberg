import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import { promptCommandCatalog } from './catalog.js';
import { fastActiveTools, isFastTurn } from './fast.js';
import { applyPromptHooksToMessages, applyPromptHooksToText } from './runtime.js';

const tools = ['search_code', 'grep', 'read_file', 'run_subagents', 'message_subagent', 'decide', 'start_background_tool', 'schedule_run', 'sleep_agent', 'mcp_db_query'];

describe('/fast prompt hook', () => {
  it('rewrites /fast into a direct-answer request with the question', () => {
    const out = applyPromptHooksToText('/fast where is chunking?');

    expect(out).toContain('where is chunking?');
    expect(isFastTurn([{ role: 'user', content: out }])).toBe(true);
  });

  it('matches only the whole trigger', () => {
    expect(applyPromptHooksToText('/FAST status?')).toContain('status?');
    expect(applyPromptHooksToText('/faster idea')).toBe('/faster idea');
  });

  it('asks for the question when /fast has no text, without restricting tools', () => {
    const out = applyPromptHooksToText('/fast');

    expect(out).toContain('typed /fast without a question');
    expect(isFastTurn([{ role: 'user', content: out }])).toBe(false);
  });

  it('is listed in the command catalog', () => {
    expect(promptCommandCatalog().map((command) => command.trigger)).toEqual(['/enhance', '/dumb', '/fast']);
  });
});

describe('fast turns', () => {
  const fast: ModelMessage[] = applyPromptHooksToMessages([{ role: 'user', content: '/fast what is cberg_chunker_open?' }]);

  it('recognise only the latest user message, so later plain turns use every tool', () => {
    const later: ModelMessage[] = [
      ...fast,
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: 'now explain the watcher' },
    ];

    expect(isFastTurn(fast)).toBe(true);
    expect(isFastTurn(later)).toBe(false);
    expect(fastActiveTools(later, tools, undefined)).toBeUndefined();
  });

  it('drop delegation, decisions, background, scheduling, and sleep tools', () => {
    expect(fastActiveTools(fast, tools, undefined)).toEqual(['search_code', 'grep', 'read_file', 'mcp_db_query']);
  });

  it('narrow the MCP activation list instead of re-adding deferred tools', () => {
    expect(fastActiveTools(fast, tools, ['search_code', 'run_subagents'])).toEqual(['search_code']);
  });
});
