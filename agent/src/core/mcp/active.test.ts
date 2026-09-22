import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import {
  isDeferredMcpTool,
  mcpToolsReferenced,
  prepareStepPatch,
  selectActiveTools,
} from './active.js';

describe('selectActiveTools', () => {
  const all = ['search_code', 'grep', 'load_mcp_tools', 'mcp_github_list_issues', 'mcp_github_create_issue'];

  it('hides MCP tools until they are loaded', () => {
    expect(selectActiveTools(all, [])).toEqual(['search_code', 'grep', 'load_mcp_tools']);
    expect(selectActiveTools(all, ['mcp_github_list_issues'])).toEqual([
      'search_code',
      'grep',
      'load_mcp_tools',
      'mcp_github_list_issues',
    ]);
  });

  it('treats only mcp_ names as deferred', () => {
    expect(isDeferredMcpTool('mcp_github_list_issues')).toBe(true);
    expect(isDeferredMcpTool('load_mcp_tools')).toBe(false);
    expect(isDeferredMcpTool('grep')).toBe(false);
  });
});

describe('prepareStepPatch', () => {
  const messages = [{ role: 'user' as const, content: 'hi' }];
  const pruned = [{ role: 'user' as const, content: 'kept' }];

  it('returns undefined when nothing changed and MCP has no deferred tools', () => {
    expect(prepareStepPatch(messages, messages, undefined)).toBeUndefined();
  });

  it('returns only the fields that changed', () => {
    expect(prepareStepPatch(messages, pruned, undefined)).toEqual({ messages: pruned });
    expect(prepareStepPatch(messages, messages, ['grep'])).toEqual({ activeTools: ['grep'] });
    expect(prepareStepPatch(messages, pruned, ['grep'])).toEqual({
      messages: pruned,
      activeTools: ['grep'],
    });
  });
});

describe('mcpToolsReferenced', () => {
  it('collects MCP tool names already in the transcript', () => {
    const messages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: '1', toolName: 'grep', input: {} },
          { type: 'tool-call', toolCallId: '2', toolName: 'mcp_github_list_issues', input: {} },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: '2',
            toolName: 'mcp_github_list_issues',
            output: { type: 'text', value: 'ok' },
          },
        ],
      },
    ];
    expect(mcpToolsReferenced(messages)).toEqual(['mcp_github_list_issues']);
  });
});
