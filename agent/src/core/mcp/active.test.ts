import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import { isDeferredMcpTool, mcpToolsReferenced, selectActiveTools } from './active.js';

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
