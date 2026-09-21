import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  discoverMcpConfigPaths,
  interpolateMcpString,
  mcpConfigFromEnv,
  parseMcpJson,
} from './config.js';
import type { McpInterpolateContext, McpStdioServer, McpUrlServer } from './types.js';

const ctx: McpInterpolateContext = {
  env: { TOKEN: 'secret', EMPTY: '' },
  workspaceFolder: '/proj',
  userHome: '/home/me',
};

function tmpTree(): string {
  return mkdtempSync(join(tmpdir(), 'cberg-mcp-'));
}

function write(path: string, body: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

describe('parseMcpJson', () => {
  it('parses a Cursor-style stdio server', () => {
    const { servers, warnings } = parseMcpJson(
      JSON.stringify({
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${env:TOKEN}' },
          },
        },
      }),
      ctx,
    );
    expect(warnings).toEqual([]);
    expect(servers).toHaveLength(1);
    const s = servers[0] as McpStdioServer;
    expect(s).toMatchObject({
      name: 'github',
      kind: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'secret' },
    });
  });

  it('parses remote url servers and infers http vs sse', () => {
    const { servers } = parseMcpJson(
      JSON.stringify({
        mcpServers: {
          docs: { url: 'https://example.com/mcp' },
          legacy: { url: 'https://example.com/sse' },
          explicit: { type: 'sse', url: 'https://example.com/mcp' },
        },
      }),
      ctx,
    );
    const byName = Object.fromEntries(servers.map((s) => [s.name, s as McpUrlServer]));
    expect(byName.docs.kind).toBe('http');
    expect(byName.docs.url).toBe('https://example.com/mcp');
    expect(byName.legacy.kind).toBe('sse');
    expect(byName.explicit.kind).toBe('sse');
    expect(byName.explicit.url).toBe('https://example.com/mcp');
  });

  it('accepts the VS Code "servers" key as an alias for mcpServers', () => {
    const { servers } = parseMcpJson(
      JSON.stringify({ servers: { fs: { command: 'npx', args: ['-y', 'server-fs'] } } }),
      ctx,
    );
    expect(servers.map((s) => s.name)).toEqual(['fs']);
  });

  it('lets mcpServers win over servers on a name collision', () => {
    const { servers } = parseMcpJson(
      JSON.stringify({
        servers: { x: { command: 'from-servers' } },
        mcpServers: { x: { command: 'from-mcpServers' } },
      }),
      ctx,
    );
    expect((servers[0] as McpStdioServer).command).toBe('from-mcpServers');
  });

  it('skips disabled servers and entries missing command/url', () => {
    const { servers, warnings } = parseMcpJson(
      JSON.stringify({
        mcpServers: {
          off: { command: 'npx', disabled: true },
          also: { command: 'npx', enabled: false },
          empty: {},
          ok: { command: 'node', args: ['srv.js'] },
        },
      }),
      ctx,
    );
    expect(servers.map((s) => s.name)).toEqual(['ok']);
    expect(warnings.some((w) => w.includes('empty'))).toBe(true);
  });

  it('interpolates headers, cwd, and workspaceFolder', () => {
    const { servers } = parseMcpJson(
      JSON.stringify({
        mcpServers: {
          remote: {
            type: 'http',
            url: 'https://example.com/mcp?ws=${workspaceFolder}',
            headers: { Authorization: 'Bearer ${env:TOKEN}' },
          },
          local: {
            command: '${userHome}/bin/mcp',
            cwd: '${workspaceFolder}/tools',
          },
        },
      }),
      ctx,
    );
    const remote = servers.find((s) => s.name === 'remote') as McpUrlServer;
    const local = servers.find((s) => s.name === 'local') as McpStdioServer;
    expect(remote.url).toBe('https://example.com/mcp?ws=/proj');
    expect(remote.headers.Authorization).toBe('Bearer secret');
    expect(local.command).toBe('/home/me/bin/mcp');
    expect(local.cwd).toBe('/proj/tools');
  });

  it('returns a warning and no servers for invalid JSON', () => {
    const { servers, warnings } = parseMcpJson('{ not json', ctx);
    expect(servers).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('treats streamable-http as http', () => {
    const { servers } = parseMcpJson(
      JSON.stringify({
        mcpServers: { a: { type: 'streamable-http', url: 'https://x/mcp' } },
      }),
      ctx,
    );
    expect((servers[0] as McpUrlServer).kind).toBe('http');
  });
});

describe('interpolateMcpString', () => {
  it('resolves ${env:NAME}, ${NAME}, and leaves unknown input refs empty', () => {
    expect(interpolateMcpString('x=${env:TOKEN}', ctx)).toBe('x=secret');
    expect(interpolateMcpString('${TOKEN}', ctx)).toBe('secret');
    expect(interpolateMcpString('${input:foo}', ctx)).toBe('');
    expect(interpolateMcpString('${env:MISSING}', ctx)).toBe('');
  });
});

describe('discoverMcpConfigPaths', () => {
  it('loads home, then project .cursor, then project .codeberg, then extra files', () => {
    const home = tmpTree();
    const repo = tmpTree();
    write(join(home, 'mcp.json'), '{}');
    write(join(repo, '.cursor', 'mcp.json'), '{}');
    write(join(repo, '.codeberg', 'mcp.json'), '{}');
    const extra = join(tmpTree(), 'override.json');
    write(extra, '{}');

    expect(
      discoverMcpConfigPaths({
        home,
        roots: [repo],
        cwd: '/unrelated',
        extra: [extra],
      }),
    ).toEqual([
      join(home, 'mcp.json'),
      join(repo, '.cursor', 'mcp.json'),
      join(repo, '.codeberg', 'mcp.json'),
      extra,
    ]);
  });

  it('does not walk cwd when indexed roots are set (launcher cwd is the checkout)', () => {
    const home = tmpTree();
    const repo = tmpTree();
    const checkout = tmpTree();
    write(join(home, 'mcp.json'), '{}');
    write(join(repo, '.codeberg', 'mcp.json'), '{}');
    write(join(checkout, '.cursor', 'mcp.json'), '{}');

    expect(
      discoverMcpConfigPaths({
        home,
        roots: [repo],
        cwd: checkout,
        extra: [],
      }),
    ).toEqual([join(home, 'mcp.json'), join(repo, '.codeberg', 'mcp.json')]);
  });

  it('uses the git project of cwd when no indexed roots are set', () => {
    const home = tmpTree();
    const project = tmpTree();
    mkdirSync(join(project, '.git'));
    const nested = join(project, 'src');
    mkdirSync(nested);
    write(join(project, '.cursor', 'mcp.json'), '{}');

    expect(
      discoverMcpConfigPaths({
        home,
        roots: [],
        cwd: nested,
        extra: [],
      }),
    ).toEqual([join(project, '.cursor', 'mcp.json')]);
  });
});

describe('mcpConfigFromEnv', () => {
  it('is enabled by default and merges later files over the same server name', () => {
    const home = tmpTree();
    const repo = tmpTree();
    write(
      join(home, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          github: { command: 'from-home' },
          keep: { command: 'keep-me' },
        },
      }),
    );
    write(
      join(repo, '.codeberg', 'mcp.json'),
      JSON.stringify({ mcpServers: { github: { command: 'from-project' } } }),
    );

    const cfg = mcpConfigFromEnv(
      { CODEBERG_HOME: home, CODEBERG_ROOT: repo },
      { cwd: repo, homedir: () => '/unused' },
    );
    expect(cfg.enabled).toBe(true);
    expect(cfg.files).toHaveLength(2);
    const github = cfg.servers.find((s) => s.name === 'github') as McpStdioServer;
    const keep = cfg.servers.find((s) => s.name === 'keep') as McpStdioServer;
    expect(github.command).toBe('from-project');
    expect(keep.command).toBe('keep-me');
  });

  it('honours CODEBERG_MCP_USE=false', () => {
    const home = tmpTree();
    write(join(home, 'mcp.json'), JSON.stringify({ mcpServers: { x: { command: 'npx' } } }));
    const cfg = mcpConfigFromEnv({ CODEBERG_HOME: home, CODEBERG_MCP_USE: 'false' }, { cwd: home });
    expect(cfg.enabled).toBe(false);
    expect(cfg.servers).toEqual([]);
  });

  it('loads envFile relative to the config file into stdio env', () => {
    const home = tmpTree();
    write(join(home, 'secrets.env'), 'API_KEY=from-file\nOTHER=1\n');
    write(
      join(home, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          s: {
            command: 'npx',
            envFile: 'secrets.env',
            env: { OTHER: 'override' },
          },
        },
      }),
    );
    const cfg = mcpConfigFromEnv({ CODEBERG_HOME: home }, { cwd: home, homedir: () => home });
    const s = cfg.servers[0] as McpStdioServer;
    expect(s.env.API_KEY).toBe('from-file');
    expect(s.env.OTHER).toBe('override');
  });

  it('parses CODEBERG_ROOTS key\\tpath records', () => {
    const home = tmpTree();
    const a = tmpTree();
    const b = tmpTree();
    write(
      join(a, '.codeberg', 'mcp.json'),
      JSON.stringify({ mcpServers: { a: { command: 'a' } } }),
    );
    write(
      join(b, '.codeberg', 'mcp.json'),
      JSON.stringify({ mcpServers: { b: { command: 'b' } } }),
    );
    const cfg = mcpConfigFromEnv(
      { CODEBERG_HOME: home, CODEBERG_ROOTS: `alpha\t${a}\nbeta\t${b}` },
      { cwd: '/unrelated' },
    );
    expect(cfg.servers.map((s) => s.name).sort()).toEqual(['a', 'b']);
  });
});
