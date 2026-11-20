import { jsonSchema, tool, type ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';

import { mcpToolSource } from '../mcp/tools.js';
import { mcpErrorText, scriptMcpNames } from './mcp.js';

function mcpTool(readOnlyHint?: boolean) {
  return {
    ...tool({
      description: 'fake MCP tool',
      inputSchema: jsonSchema<Record<string, unknown>>({ type: 'object' }),
      execute: async () => ({ content: [] }),
    }),
    ...(readOnlyHint === undefined ? {} : { metadata: { annotations: { readOnlyHint } } }),
  };
}

const tools: ToolSet = {
  mcp_jira_search: mcpTool(true),
  mcp_jira_create_issue: mcpTool(false),
  mcp_databases_query: mcpTool(),
  mcp_databases_list: mcpTool(),
  mcp_github_list: mcpTool(true),
};

function source(loaded: string[]) {
  return {
    activeToolNames: () => loaded,
    reports: () => [
      { name: 'jira', state: 'connected' as const, tools: [
        { name: 'search', callable: 'mcp_jira_search' },
        { name: 'create_issue', callable: 'mcp_jira_create_issue' },
      ] },
      { name: 'databases', state: 'connected' as const, tools: [
        { name: 'query', callable: 'mcp_databases_query' },
        { name: 'list', callable: 'mcp_databases_list' },
      ] },
      { name: 'github', state: 'connected' as const, tools: [{ name: 'list', callable: 'mcp_github_list' }] },
    ],
  };
}

describe('scriptMcpNames', () => {
  it('offers loaded tools their server marks read-only', () => {
    const loaded = ['mcp_jira_search', 'mcp_jira_create_issue', 'mcp_databases_query'];

    expect(scriptMcpNames({ tools, source: source(loaded), trusted: [] })).toEqual(['mcp_jira_search']);
  });

  it('offers every loaded tool from a trusted server', () => {
    const loaded = ['mcp_databases_query', 'mcp_jira_create_issue'];

    expect(scriptMcpNames({ tools, source: source(loaded), trusted: ['databases'] })).toEqual(['mcp_databases_query']);
  });

  it('never offers a tool the agent has not loaded', () => {
    const names = scriptMcpNames({ tools, source: source([]), trusted: ['jira', 'databases'] });

    expect(names).toEqual([]);
  });

  it('is empty without an MCP source', () => {
    expect(scriptMcpNames({ tools, source: undefined, trusted: ['jira'] })).toEqual([]);
  });
});

describe('scriptMcpNames with a connected MCP source', () => {
  it('follows load_mcp_tools and the read-only mark the server sent', async () => {
    const server = { name: 'jira', kind: 'stdio' as const, command: 'jira-mcp', args: [], env: {} };
    const source = mcpToolSource({
      config: { enabled: true, servers: [server], files: [], warnings: [] },
      log: () => {},
      connect: async () => ({ tools: { search: mcpTool(true), create: mcpTool(false) }, close: async () => {} }),
    });

    const registered = await source.tools();
    const names = () => scriptMcpNames({ tools: registered, source, trusted: [] });

    expect(names()).toEqual([]);

    await registered.load_mcp_tools!.execute!({ names: ['mcp_jira_search', 'mcp_jira_create'] }, {} as never);

    expect(names()).toEqual(['mcp_jira_search']);
    expect(scriptMcpNames({ tools: registered, source, trusted: ['jira'] })).toEqual(['mcp_jira_create', 'mcp_jira_search']);
  });
});

describe('mcpErrorText', () => {
  it('reads the text of an MCP error result', () => {
    const result = { isError: true, content: [{ type: 'text', text: 'not found' }, { type: 'image', data: 'x' }] };

    expect(mcpErrorText(result)).toBe('not found');
  });

  it('ignores successful and non-MCP results', () => {
    expect(mcpErrorText({ isError: false, content: [] })).toBeUndefined();
    expect(mcpErrorText({ matches: [] })).toBeUndefined();
    expect(mcpErrorText('text')).toBeUndefined();
  });

  it('falls back when an error result has no text', () => {
    expect(mcpErrorText({ isError: true, content: [] })).toBe('the MCP tool reported an error');
  });
});
