import { describe, expect, it } from 'vitest';

import { AGENT_SYSTEM, agentSystemPrompt } from './prompt.js';

describe('agentSystemPrompt', () => {
  it('keeps built-in tools immediately available and limits discovery to MCP tools', () => {
    expect(AGENT_SYSTEM).toContain('Every tool listed below is built in');
    expect(AGENT_SYSTEM).toContain('Only tools whose names start with `mcp_` are discovery-based');
    expect(AGENT_SYSTEM).toContain('Set `literal: true` for plain text');
    expect(AGENT_SYSTEM).toContain('retry once with fewer constraints');
  });

  it('is exactly AGENT_SYSTEM when web and MCP are off', () => {
    expect(agentSystemPrompt({ enabled: false, search: false })).toBe(AGENT_SYSTEM);
  });

  it('mentions fetch_url but not web_search when web is on without a backend', () => {
    const p = agentSystemPrompt({ enabled: true, search: false });
    expect(p).toContain('fetch_url');
    expect(p).not.toContain('- web_search:');
  });

  it('lists connected MCP servers by callable name', () => {
    const p = agentSystemPrompt({
      enabled: false,
      search: false,
      mcp: [
        {
          name: 'github',
          state: 'connected',
          tools: [{ name: 'list_issues', callable: 'mcp_github_list_issues' }],
        },
        {
          name: 'linear',
          state: 'connected',
          tools: [{ name: 'list_issues', callable: 'mcp_linear_list_issues' }],
        },
      ],
    });
    expect(p).toContain('github');
    expect(p).toContain('linear');
    expect(p).toContain('mcp_github_list_issues');
    expect(p).toContain('mcp_linear_list_issues');
    expect(p).toContain('load_mcp_tools');
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
    expect(AGENT_SYSTEM).toContain('What query loads a user\'s orders?');
    expect(AGENT_SYSTEM).toContain('How many orders are open right now?');
    expect(AGENT_SYSTEM).toContain('SELECT status, count(*) FROM orders GROUP BY status');
    expect(AGENT_SYSTEM).toContain('Does the orders table the API writes match');
    expect(AGENT_SYSTEM).toContain('Show me the schema.');
    expect(AGENT_SYSTEM).toContain('Write a query for orders placed yesterday that are still unpaid.');
    expect(AGENT_SYSTEM).toContain('Should I run this?');
    expect(AGENT_SYSTEM).toContain('which database indexes migrations or existing queries already use');
    expect(AGENT_SYSTEM).toContain('This reads unpaid orders created yesterday');
    expect(AGENT_SYSTEM).toContain("SELECT id, status, created_at");
    expect(AGENT_SYSTEM).toContain('leave the live database alone');
    expect(AGENT_SYSTEM).toContain('Do not compose a new statement');
    expect(AGENT_SYSTEM).not.toContain('postgres_list_databases');
    expect(AGENT_SYSTEM).not.toContain('mongo_list_collections');
    const p = agentSystemPrompt({
      enabled: false,
      search: false,
      mcp: [
        {
          name: 'databases',
          state: 'connected',
          tools: [{ name: 'query', callable: 'mcp_databases_query' }],
        },
      ],
    });
    expect(p).toContain('Respect the index');
    expect(p).toContain('mcp_databases_query');
    expect(p).toContain('load_mcp_tools');
    expect(p).not.toContain('postgres_list_databases');
  });

  it('lists MCP catalogs and unavailable servers without inlining schemas', () => {
    const p = agentSystemPrompt({
      enabled: false,
      search: false,
      contextRoot: '/tmp/context',
      mcp: [
        {
          name: 'github',
          state: 'connected',
          catalogDir: '/tmp/context/mcp/github',
          tools: [{ name: 'list_issues', callable: 'mcp_github_list_issues' }],
        },
        {
          name: 'slack',
          state: 'unavailable',
          tools: [],
          detail: 'HTTP 401 Unauthorized',
          catalogDir: '/tmp/context/mcp/slack',
        },
      ],
    });
    expect(p).toContain('load_mcp_tools');
    expect(p).toContain('mcp_github_list_issues');
    expect(p).toContain('/tmp/context/mcp/github');
    expect(p).toContain('slack: unavailable');
    expect(p).toContain('re-authenticate');
    expect(p).toContain('context_grep');
    expect(p).not.toContain('"type": "object"');
  });

  it('lists skill names and descriptions, not the skill body', () => {
    const p = agentSystemPrompt({
      enabled: false,
      search: false,
      contextRoot: '/tmp/context',
      skills: [
        {
          name: 'review-diff',
          description: 'Summarize risk in a diff.',
          file: '/repo/.agents/skills/review-diff/SKILL.md',
          dir: '/repo/.agents/skills/review-diff',
        },
      ],
    });
    expect(p).toContain('review-diff');
    expect(p).toContain('Summarize risk in a diff.');
    expect(p).toContain('/repo/.agents/skills/review-diff/SKILL.md');
    expect(p).toContain('Read the SKILL.md');
  });

  it('omits the MCP section when no servers connected', () => {
    const p = agentSystemPrompt({ enabled: false, search: false, mcp: [] });
    expect(p).toBe(AGENT_SYSTEM);
  });
});
