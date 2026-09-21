import { describe, expect, it } from 'vitest';

import { AGENT_SYSTEM, agentSystemPrompt } from './prompt.js';

describe('agentSystemPrompt', () => {
  it('is exactly AGENT_SYSTEM when web and MCP are off', () => {
    expect(agentSystemPrompt({ enabled: false, search: false })).toBe(AGENT_SYSTEM);
  });

  it('mentions fetch_url but not web_search when web is on without a backend', () => {
    const p = agentSystemPrompt({ enabled: true, search: false });
    expect(p).toContain('fetch_url');
    expect(p).not.toContain('- web_search:');
  });

  it('lists connected MCP servers and the mcp_<server>_<tool> naming scheme', () => {
    const p = agentSystemPrompt({
      enabled: false,
      search: false,
      mcpServers: ['github', 'linear'],
    });
    expect(p).toContain('github');
    expect(p).toContain('linear');
    expect(p).toContain('mcp_<server>_<tool>');
    expect(p).toContain(AGENT_SYSTEM);
    expect(p).not.toContain('built-in multi-db MCP');
  });

  it('lists database tools only after that server connects', () => {
    const p = agentSystemPrompt({
      enabled: false,
      search: false,
      mcpServers: ['databases'],
      mcpTools: {
        databases: [
          'postgres_query',
          'list_connections',
          'postgres_list_databases',
          'mongo_list_databases',
          'landscape',
        ],
      },
    });
    expect(p).toContain('built-in multi-db MCP');
    expect(p).toContain('list the databases available');
    expect(p).toContain('schemas, collections, tables');
    expect(p).toContain('Map those names directly onto any code you search');
    expect(p).toContain('mcp_databases_postgres_list_databases');
    expect(p).toContain('schemas in each database');
    expect(p).toContain('mcp_databases_mongo_list_databases');
    expect(p).toContain('collections in each database');
    expect(p).toContain('mcp_databases_landscape');
    expect(p).not.toContain('mcp_databases_redis_scan');
    const listed = p.slice(p.indexOf('Registered database tools:'));
    expect(listed.indexOf('list_connections')).toBeLessThan(listed.indexOf('postgres_query'));
  });

  it('omits the MCP section when no servers connected', () => {
    const p = agentSystemPrompt({ enabled: false, search: false, mcpServers: [] });
    expect(p).toBe(AGENT_SYSTEM);
  });
});
