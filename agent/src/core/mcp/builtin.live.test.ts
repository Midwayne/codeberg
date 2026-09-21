import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { mcpConfigFromEnv } from './config.js';
import { mcpToolSource } from './tools.js';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'build', 'dbmcp');

const SPEC = `server:
  serve_mode: stdio
defaults:
  access: read_only
  connect_on_start: false
  fail_on_connect_error: false
connections:
  - name: cache
    type: redis
    uri: redis://127.0.0.1:6399/0
    access: read_only
    connect_on_start: false
    fail_on_connect_error: false
`;

// Skipped until `make build-dbmcp` produces build/dbmcp. The handshake is the
// check that an enabled, working server actually defines tools for the agent.
describe.skipIf(!existsSync(BIN))('builtin database MCP handshake', () => {
  it('registers live tools when dbmcp starts', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cberg-dbmcp-live-'));
    const spec = join(home, 'spec.yml');
    writeFileSync(spec, SPEC, 'utf8');
    const cfg = mcpConfigFromEnv(
      {
        CODEBERG_HOME: home,
        CODEBERG_DBMCP_USE: 'true',
        CODEBERG_DBMCP_BIN: BIN,
        CODEBERG_DBMCP_SPEC: spec,
        CODEBERG_MCP_USE: 'false',
      },
      { cwd: home },
    );
    expect(cfg.servers.map((s) => s.name)).toEqual(['databases']);
    const source = mcpToolSource({ config: cfg, log: () => {} });
    try {
      const tools = await source.tools();
      expect(source.connectedServers()).toEqual(['databases']);
      expect(tools).toHaveProperty('mcp_databases_list_connections');
      expect(tools).toHaveProperty('mcp_databases_list_permissions');
      expect(tools).toHaveProperty('mcp_databases_redis_get');
      const listed = source.connectedTools().databases ?? [];
      expect(listed).toContain('list_connections');
      const list = tools.mcp_databases_list_connections as unknown as {
        execute: (
          input: Record<string, unknown>,
          options: { toolCallId: string },
        ) => Promise<unknown>;
      };
      const result = await list.execute({}, { toolCallId: 'live' });
      expect(JSON.stringify(result)).toContain('cache');
    } finally {
      await source.close();
    }
  }, 20_000);
});
