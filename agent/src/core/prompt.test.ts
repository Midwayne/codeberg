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
    expect(p).not.toContain('postgres_list_databases');
    expect(p).not.toContain('mongo_list_collections');
  });

  it('tells the agent to find queries in the index before running them', () => {
    expect(AGENT_SYSTEM).toContain('Respect the index');
    expect(AGENT_SYSTEM).toContain(
      'Always look for the query in the indexed code before you execute it against a database',
    );
    expect(AGENT_SYSTEM).toContain('unless the user has explicitly defined the path to take');
    const p = agentSystemPrompt({
      enabled: false,
      search: false,
      mcpServers: ['databases'],
    });
    expect(p).toContain('Respect the index');
    expect(p).not.toContain('mcp_databases_');
    expect(p).toContain('Tool names, arguments, and descriptions come from the server');
  });

  it('omits the MCP section when no servers connected', () => {
    const p = agentSystemPrompt({ enabled: false, search: false, mcpServers: [] });
    expect(p).toBe(AGENT_SYSTEM);
  });
});
