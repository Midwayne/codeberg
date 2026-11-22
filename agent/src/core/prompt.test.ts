import { describe, expect, it } from 'vitest';

import { AGENT_SYSTEM, agentSystemPrompt, agentSystemSections } from './prompt.js';

describe('agentSystemPrompt', () => {
  it.each([false, true])('uses lexical guidance without embeddings (compact: %s)', (compact) => {
    const prompt = agentSystemPrompt({ enabled: false, search: false, vectors: false, compact });

    expect(prompt).not.toContain('search_code');
    expect(prompt).not.toContain('hybrid_search');
    expect(prompt).not.toContain('Choose semantic search');
    expect(prompt).toContain('grep');
    expect(prompt).toContain('find_symbol');
  });

  it('replaces the built-in instructions with custom ones and keeps the dynamic sections', () => {
    const prompt = agentSystemPrompt({ enabled: false, search: false, instructions: 'Custom rules for this model.', contextRoot: '/ctx', batch: 5 });

    expect(prompt.startsWith('Custom rules for this model.')).toBe(true);
    expect(prompt).not.toContain('Data-source questions:');
    expect(prompt).toContain('Dynamic context:');
    expect(prompt).toContain('Batch tool:');
  });

  it('keeps built-in tools immediately available and limits discovery to MCP tools', () => {
    expect(AGENT_SYSTEM).toContain('Every built-in tool is callable now');
    expect(AGENT_SYSTEM).toContain('Only tools whose names start with `mcp_` need discovery');
  });

  it('routes by lead instead of repeating each tool description', () => {
    expect(AGENT_SYSTEM).toContain('Pick the tool by the lead you have:');
    expect(AGENT_SYSTEM).not.toContain('Set `literal: true` for plain text');
    expect(AGENT_SYSTEM).not.toContain('- glob: find files by pattern.');
  });

  it('states the citation rule once', () => {
    expect(AGENT_SYSTEM.split('[path:start-end]')).toHaveLength(2);
    expect(AGENT_SYSTEM).toContain('Evidence and citations:');
  });

  it('keeps MCP servers and skills out of the stable section', () => {
    const sections = agentSystemSections({
      enabled: true,
      search: true,
      contextRoot: '/ctx',
      mcp: [{ name: 'github', state: 'connected', tools: [{ name: 'list_issues', callable: 'mcp_github_list_issues' }] }],
      skills: [{ name: 'review-diff', description: 'Summarize risk.', file: '/s/SKILL.md', dir: '/s' }],
    });

    expect(sections.stable).toBe(agentSystemSections({ enabled: true, search: true, contextRoot: '/ctx' }).stable);
    expect(sections.stable).not.toContain('mcp_github_list_issues');
    expect(sections.dynamic).toContain('mcp_github_list_issues');
    expect(sections.dynamic).toContain('review-diff');
  });

  it.each([false, true])('tells the agent to resolve trivial gaps without asking (compact: %s)', (compact) => {
    const prompt = agentSystemPrompt({ enabled: false, search: false, compact });

    expect(prompt).toContain('repository keys, paths');
    expect(prompt).toMatch(/search (them all|every repository)/);
    expect(prompt).toContain('retry');
  });

  it('asks for exhaustive lists and versioned answers in the full prompt', () => {
    expect(AGENT_SYSTEM).toContain('Work it out yourself:');
    expect(AGENT_SYSTEM).toContain('page past limits on truncated results');
    expect(AGENT_SYSTEM).toContain("read the version from the project's manifest or lockfile");
  });

  it('asks every model to group independent tool calls into one response', () => {
    expect(AGENT_SYSTEM).toContain('Tool-call efficiency:');
    expect(AGENT_SYSTEM).toContain('Put every independent tool call in the same response');
    expect(AGENT_SYSTEM).toContain('Wait for a result only when the next call needs it');
  });

  it('describes batch only when the tool is registered', () => {
    expect(AGENT_SYSTEM).not.toContain('- batch:');

    const p = agentSystemPrompt({ enabled: false, search: false, batch: 8 });
    expect(p).toContain('- batch: run up to 8 independent tool calls');
    expect(p.startsWith(AGENT_SYSTEM)).toBe(true);
  });

  it('is exactly AGENT_SYSTEM when web and MCP are off', () => {
    expect(agentSystemPrompt({ enabled: false, search: false })).toBe(AGENT_SYSTEM);
  });

  it('never advertises unavailable learning tools when disabled', () => {
    const prompt = agentSystemPrompt({ enabled: false, search: false, learning: false });
    expect(prompt).not.toContain('search_learning');
    expect(prompt).not.toContain('search_knowledge');
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

  it('leaves the database rules out when no database server is connected', () => {
    expect(AGENT_SYSTEM).not.toContain('Respect the index');
    expect(AGENT_SYSTEM).not.toContain('Should I run this?');

    const p = agentSystemPrompt({
      enabled: false,
      search: false,
      mcp: [{ name: 'github', state: 'connected', tools: [{ name: 'list_issues', callable: 'mcp_github_list_issues' }] }],
    });

    expect(p).not.toContain('Respect the index');
  });

  it.each([
    ['databases', 'query'],
    ['warehouse', 'run_sql'],
    ['pg', 'postgres_query'],
  ])('tells the agent to find queries in the index before running them (%s)', (name, tool) => {
    const p = agentSystemPrompt({
      enabled: false,
      search: false,
      mcp: [{ name, state: 'connected', tools: [{ name: tool, callable: `mcp_${name}_${tool}` }] }],
    });

    expect(p).toContain('Respect the index');
    expect(p).toContain('Always look for the query in the indexed code before you execute it against a database');
    expect(p).toContain('unless the user has explicitly defined the path to take');
    expect(p).toContain("What query loads a user's orders?");
    expect(p).toContain('How many orders are open right now?');
    expect(p).toContain('SELECT status, count(*) FROM orders GROUP BY status');
    expect(p).toContain('Does the orders table the API writes match');
    expect(p).toContain('Show me the schema.');
    expect(p).toContain('Write a query for orders placed yesterday that are still unpaid.');
    expect(p).toContain('Should I run this?');
    expect(p).toContain('which database indexes migrations or existing queries already use');
    expect(p).toContain('This reads unpaid orders created yesterday');
    expect(p).toContain('SELECT id, status, created_at');
    expect(p).toContain('leave the live database alone');
    expect(p).toContain('Do not compose a new statement');
    expect(p).toContain(`mcp_${name}_${tool}`);
    expect(p).toContain('load_mcp_tools');
    expect(p).not.toContain('postgres_list_databases');
    expect(p).not.toContain('mongo_list_collections');
  });

  it('skips the database rules for an unavailable database server', () => {
    const p = agentSystemPrompt({
      enabled: false,
      search: false,
      mcp: [{ name: 'databases', state: 'unavailable', tools: [], detail: 'spawn failed' }],
    });

    expect(p).not.toContain('Respect the index');
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
