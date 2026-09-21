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
  });

  it('omits the MCP section when no servers connected', () => {
    const p = agentSystemPrompt({ enabled: false, search: false, mcpServers: [] });
    expect(p).toBe(AGENT_SYSTEM);
  });
});
