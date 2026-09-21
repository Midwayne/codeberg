import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { mcpConfigFromEnv } from './config.js';
import type { McpStdioServer } from './types.js';

function tmpTree(): string {
  return mkdtempSync(join(tmpdir(), 'cberg-dbmcp-'));
}

function write(path: string, body: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

function present(paths: string[]): (path: string) => boolean {
  const set = new Set(paths);
  return (path) => set.has(path);
}

describe('builtin database MCP', () => {
  it('stays off unless CODEBERG_DBMCP_USE is set', () => {
    const home = tmpTree();
    const spec = join(home, 'spec.yml');
    write(spec, 'connections: []\n');
    const cfg = mcpConfigFromEnv(
      { CODEBERG_HOME: home, CODEBERG_MCP_USE: 'false' },
      { cwd: home, exists: present([spec]), readFile: () => null },
    );
    expect(cfg.enabled).toBe(false);
    expect(cfg.servers).toEqual([]);
  });

  it('registers databases from spec.yml and the built binary', () => {
    const home = tmpTree();
    const root = tmpTree();
    const spec = join(home, 'spec.yml');
    const bin = join(root, 'build', 'dbmcp');
    write(spec, 'connections: []\n');
    const cfg = mcpConfigFromEnv(
      {
        CODEBERG_HOME: home,
        CODEBERG_DBMCP_USE: 'true',
        CODEBERG_MCP_USE: 'false',
        POSTGRES_URI: 'postgres://localhost/app',
      },
      {
        cwd: root,
        homedir: () => '/home/me',
        exists: present([spec, bin, join(root, 'Makefile'), join(root, 'agent')]),
      },
    );
    expect(cfg.enabled).toBe(true);
    expect(cfg.warnings).toEqual([]);
    expect(cfg.servers).toHaveLength(1);
    const server = cfg.servers[0] as McpStdioServer;
    expect(server).toMatchObject({
      name: 'databases',
      kind: 'stdio',
      command: bin,
      args: ['-spec', spec],
    });
    expect(server.env.POSTGRES_URI).toBe('postgres://localhost/app');
  });

  it('prefers spec.yml over spec.yaml in the config directory', () => {
    const home = tmpTree();
    const yml = join(home, 'spec.yml');
    const yaml = join(home, 'spec.yaml');
    const bin = '/opt/dbmcp';
    const cfg = mcpConfigFromEnv(
      {
        CODEBERG_HOME: home,
        CODEBERG_DBMCP_USE: '1',
        CODEBERG_DBMCP_BIN: bin,
        CODEBERG_MCP_USE: 'false',
      },
      { cwd: home, exists: present([yml, yaml, bin]) },
    );
    const server = cfg.servers[0] as McpStdioServer;
    expect(server.args).toEqual(['-spec', yml]);
  });

  it('falls back to spec.yaml and warns when the spec and binary are missing', () => {
    const home = tmpTree();
    const yaml = join(home, 'spec.yaml');
    const bin = '/opt/dbmcp';
    const withYaml = mcpConfigFromEnv(
      {
        CODEBERG_HOME: home,
        CODEBERG_DBMCP_USE: 'on',
        CODEBERG_DBMCP_BIN: bin,
        CODEBERG_MCP_USE: 'false',
      },
      { cwd: home, exists: present([yaml, bin]) },
    );
    expect((withYaml.servers[0] as McpStdioServer).args).toEqual(['-spec', yaml]);

    const missing = mcpConfigFromEnv(
      { CODEBERG_HOME: home, CODEBERG_DBMCP_USE: 'true', CODEBERG_MCP_USE: 'false' },
      { cwd: home, exists: () => false },
    );
    expect(missing.enabled).toBe(true);
    expect(missing.servers).toEqual([]);
    expect(missing.warnings.join('\n')).toContain('spec.yml');
    expect(missing.warnings.join('\n')).toContain('dbmcp binary');
  });

  it('lets an mcp.json databases entry replace the built-in command', () => {
    const home = tmpTree();
    const spec = join(home, 'spec.yml');
    const bin = '/opt/dbmcp';
    write(
      join(home, 'mcp.json'),
      JSON.stringify({ mcpServers: { databases: { command: 'custom-dbmcp', args: ['--other'] } } }),
    );
    const cfg = mcpConfigFromEnv(
      {
        CODEBERG_HOME: home,
        CODEBERG_DBMCP_USE: 'true',
        CODEBERG_DBMCP_BIN: bin,
      },
      {
        cwd: home,
        exists: present([spec, bin, join(home, 'mcp.json')]),
        readFile: (path) =>
          path === join(home, 'mcp.json')
            ? JSON.stringify({
                mcpServers: { databases: { command: 'custom-dbmcp', args: ['--other'] } },
              })
            : null,
      },
    );
    const server = cfg.servers.find((s) => s.name === 'databases') as McpStdioServer;
    expect(server.command).toBe('custom-dbmcp');
    expect(server.args).toEqual(['--other']);
  });

  it('honours CODEBERG_DBMCP_SPEC', () => {
    const home = tmpTree();
    const spec = join(home, 'custom.yml');
    const bin = '/opt/dbmcp';
    const cfg = mcpConfigFromEnv(
      {
        CODEBERG_HOME: home,
        CODEBERG_DBMCP_USE: 'yes',
        CODEBERG_DBMCP_BIN: bin,
        CODEBERG_DBMCP_SPEC: spec,
        CODEBERG_MCP_USE: 'false',
      },
      { cwd: home, exists: present([spec, bin, join(home, 'spec.yml')]) },
    );
    expect((cfg.servers[0] as McpStdioServer).args).toEqual(['-spec', spec]);
  });
});
