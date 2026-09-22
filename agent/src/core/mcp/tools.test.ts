import { jsonSchema } from 'ai';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { ContextStore } from '../context/store.js';
import { catalogFolder } from './catalog.js';
import { connectMcpServer } from './client.js';
import { mcpToolName } from './names.js';
import { mcpToolSource } from './tools.js';
import type { McpConfig, McpServer } from './types.js';

function cfg(over: Partial<McpConfig> = {}): McpConfig {
  return { enabled: true, servers: [], files: [], warnings: [], ...over };
}

const stdio: McpServer = {
  name: 'github',
  kind: 'stdio',
  command: 'npx',
  args: ['-y', 'srv'],
  env: { TOKEN: 'x' },
};

describe('mcpToolName', () => {
  it('prefixes and sanitizes to [A-Za-z0-9_] within 64 chars', () => {
    expect(mcpToolName('github', 'list_issues')).toBe('mcp_github_list_issues');
    expect(mcpToolName('my-server', 'foo.bar')).toBe('mcp_my_server_foo_bar');
    const long = mcpToolName('s', 'x'.repeat(80));
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long.startsWith('mcp_s_')).toBe(true);
  });
});

describe('mcpToolSource', () => {
  it('registers nothing when disabled or when no servers are configured', async () => {
    expect(Object.keys(await mcpToolSource({ config: cfg({ enabled: false }) }).tools())).toEqual(
      [],
    );
    expect(Object.keys(await mcpToolSource({ config: cfg() }).tools())).toEqual([]);
  });

  it('prefixes tools with mcp_<server>_ and annotates a copy of the description', async () => {
    const listed = { description: 'List issues', execute: async () => 'ok' };
    const source = mcpToolSource({
      config: cfg({ servers: [stdio] }),
      log: () => {},
      connect: async () => ({
        tools: { list_issues: listed as never },
        close: async () => {},
      }),
    });
    const tools = await source.tools();
    expect(Object.keys(tools)).toEqual(['mcp_github_list_issues', 'load_mcp_tools']);
    expect((tools.mcp_github_list_issues as { description?: string }).description).toBe(
      'MCP server "github": List issues',
    );
    expect(listed.description).toBe('List issues');
    const again = await source.tools();
    expect((again.mcp_github_list_issues as { description?: string }).description).toBe(
      'MCP server "github": List issues',
    );
    expect(source.connectedServers()).toEqual(['github']);
    expect(source.connectedTools()).toEqual({ github: ['list_issues'] });
  });

  it('logs warnings when enabled even if no server is configured', async () => {
    const log = vi.fn();
    const source = mcpToolSource({
      config: cfg({ warnings: ['database MCP is enabled but no spec file was found'] }),
      log,
    });
    expect(Object.keys(await source.tools())).toEqual([]);
    expect(log).toHaveBeenCalledWith('› MCP: database MCP is enabled but no spec file was found');
    expect(source.connectedTools()).toEqual({});
  });

  it('skips a server that fails to connect and still loads the others', async () => {
    const log = vi.fn();
    const source = mcpToolSource({
      config: cfg({
        servers: [stdio, { ...stdio, name: 'linear', command: 'linear-mcp' }],
        warnings: ['bad json in extra file'],
      }),
      log,
      connect: async (server) => {
        if (server.name === 'github') throw new Error('spawn npx ENOENT');
        return {
          tools: { ping: { description: 'ping' } as never },
          close: async () => {},
        };
      },
    });
    const tools = await source.tools();
    expect(Object.keys(tools)).toEqual(['mcp_linear_ping', 'load_mcp_tools']);
    expect(source.connectedServers()).toEqual(['linear']);
    expect(source.connectedTools()).toEqual({ linear: ['ping'] });
    expect(log.mock.calls.some((c) => String(c[0]).includes('github'))).toBe(true);
  });

  it('lets the first registered tool win on a sanitized-name collision', async () => {
    const colliding = mcpToolSource({
      config: cfg({ servers: [stdio] }),
      log: () => {},
      connect: async () => ({
        tools: {
          'list.issues': { tag: 'dot' } as never,
          list_issues: { tag: 'under' } as never,
        },
        close: async () => {},
      }),
    });
    const tools = await colliding.tools();
    expect((tools.mcp_github_list_issues as unknown as { tag: string }).tag).toBe('dot');
  });

  it('writes one catalog folder per server and activates tools on demand', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cberg-mcp-ctx-'));
    const context = ContextStore.open(root);
    const source = mcpToolSource({
      config: cfg({
        servers: [stdio, { ...stdio, name: 'slack', command: 'slack-mcp' }],
      }),
      log: () => {},
      context,
      connect: async (server) => {
        if (server.name === 'slack') throw new Error('HTTP 401 Unauthorized');
        return {
          tools: {
            list_issues: {
              description: 'List issues in a repository',
              inputSchema: jsonSchema({
                type: 'object',
                properties: { repo: { type: 'string' } },
                required: ['repo'],
              }),
            } as never,
          },
          close: async () => {},
        };
      },
    });
    const tools = await source.tools();
    expect(tools).toHaveProperty('mcp_github_list_issues');
    expect(tools).toHaveProperty('load_mcp_tools');
    expect(source.activeToolNames()).toEqual([]);
    const names = Object.keys(tools);
    expect(source.activeTools(names, [])).toEqual(names.filter((name) => !name.startsWith('mcp_')));
    expect(
      source.activeTools(names, [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: '1',
              toolName: 'mcp_github_list_issues',
              input: {},
            },
          ],
        },
      ]),
    ).toContain('mcp_github_list_issues');
    expect(source.activeTools(['grep'], [])).toBeUndefined();
    expect(source.reports().map((report) => report.state)).toEqual(['connected', 'unavailable']);

    const github = source.reports().find((report) => report.name === 'github');
    const slack = source.reports().find((report) => report.name === 'slack');
    expect(github?.catalogDir).toBeTruthy();
    expect(slack?.catalogDir).toBeTruthy();
    expect(github?.catalogDir).not.toBe(slack?.catalogDir);
    const catalog = readFileSync(join(github!.catalogDir!, 'list_issues.json'), 'utf8');
    expect(catalog).toContain('List issues in a repository');
    expect(catalog).toContain('mcp_github_list_issues');
    expect(catalog).toContain('"repo"');
    const status = readFileSync(join(slack!.catalogDir!, 'STATUS.txt'), 'utf8');
    expect(status).toContain('unavailable');
    expect(status).toContain('401');

    const load = tools.load_mcp_tools as unknown as {
      execute: (input: { names: string[] }, options: unknown) => Promise<{
        loaded: string[];
        missing: string[];
      }>;
    };
    const loaded = await load.execute(
      { names: ['mcp_github_list_issues', 'mcp_slack_missing'] },
      {},
    );
    expect(loaded.loaded).toEqual(['mcp_github_list_issues']);
    expect(loaded.missing).toEqual(['mcp_slack_missing']);
    expect(source.activeToolNames()).toEqual(['mcp_github_list_issues']);
  });

  it('registers load_mcp_tools when every server fails to connect', async () => {
    const source = mcpToolSource({
      config: cfg({ servers: [stdio] }),
      log: () => {},
      connect: async () => {
        throw new Error('down');
      },
    });
    const tools = await source.tools();
    expect(Object.keys(tools)).toEqual(['load_mcp_tools']);
    expect(source.reports()).toEqual([
      { name: 'github', state: 'unavailable', tools: [], detail: 'down' },
    ]);
  });

  it('gives colliding sanitized names distinct catalog directories', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cberg-mcp-folder-'));
    const context = ContextStore.open(root);
    const source = mcpToolSource({
      config: cfg({
        servers: [
          { ...stdio, name: 'a/b' },
          { ...stdio, name: 'a_b', command: 'other' },
        ],
      }),
      log: () => {},
      context,
      connect: async (server) => ({
        tools: {
          [server.name === 'a/b' ? 'left' : 'right']: { description: server.name } as never,
        },
        close: async () => {},
      }),
    });
    await source.tools();
    const reports = source.reports();
    expect(reports.map((report) => report.name)).toEqual(['a/b', 'a_b']);
    expect(reports[0]?.catalogDir).toBe(join(root, 'mcp', catalogFolder('a/b')));
    expect(reports[1]?.catalogDir).toBe(join(root, 'mcp', catalogFolder('a_b')));
    expect(reports[0]?.catalogDir).not.toBe(reports[1]?.catalogDir);
    expect(readFileSync(join(reports[0]!.catalogDir!, 'left.json'), 'utf8')).toContain('"server": "a/b"');
    expect(readFileSync(join(reports[1]!.catalogDir!, 'right.json'), 'utf8')).toContain('"server": "a_b"');
  });

  it('closes every connected client', async () => {
    const closed: string[] = [];
    const source = mcpToolSource({
      config: cfg({
        servers: [stdio, { ...stdio, name: 'other' }],
      }),
      log: () => {},
      connect: async (server) => ({
        tools: { t: {} as never },
        close: async () => {
          closed.push(server.name);
        },
      }),
    });
    await source.tools();
    await source.close();
    expect(closed.sort()).toEqual(['github', 'other']);
  });
});

describe('connectMcpServer', () => {
  it('builds a stdio transport from command/args/env/cwd', async () => {
    const seen: unknown[] = [];
    class FakeStdio {
      constructor(opts: unknown) {
        seen.push(opts);
      }
    }
    await connectMcpServer(stdio, {
      StdioTransport: FakeStdio as never,
      createClient: async ({ transport }) => {
        expect(transport).toBeInstanceOf(FakeStdio);
        return { tools: async () => ({}), close: async () => {} };
      },
    });
    expect(seen[0]).toMatchObject({
      command: 'npx',
      args: ['-y', 'srv'],
      env: { TOKEN: 'x' },
    });
  });

  it('uses http/sse transport config for url servers', async () => {
    const transports: unknown[] = [];
    await connectMcpServer(
      {
        name: 'docs',
        kind: 'http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer t' },
      },
      {
        createClient: async ({ transport }) => {
          transports.push(transport);
          return { tools: async () => ({}), close: async () => {} };
        },
      },
    );
    expect(transports[0]).toEqual({
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer t' },
    });
  });
});
