import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

import { DaemonClient } from '../client.js';
import { ContextStore } from '../context/store.js';
import { mcpToolSource } from '../mcp/tools.js';
import { webConfigFromEnv } from '../web/config.js';
import { createAgentTools } from './agent-tools.js';

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

it.each([false, true])('matches semantic tool registration to daemon capabilities: %s', async (vectors) => {
  const home = mkdtempSync(join(tmpdir(), 'codeberg-no-embedding-'));
  homes.push(home);

  const daemon = new DaemonClient('http://unused.test');
  const names = ['grep', 'read_file', 'find_symbol', 'search_graph', ...(vectors ? ['search', 'hybrid_search'] : [])];
  const list = vi.spyOn(daemon, 'listTools').mockResolvedValue(names.map((name) => ({
    name, description: name, schema: { type: 'object' },
  })));

  const tools = await createAgentTools({
    env: { CODEBERG_HOME: home }, daemon, context: ContextStore.open(join(home, 'context')),
    web: webConfigFromEnv({ CODEBERG_WEB_USE: 'false' }),
    mcp: () => mcpToolSource({ config: { enabled: false, servers: [], files: [], warnings: [] } }),
    defaultSearchK: 8, searchBundle: true, onResults: vi.fn(),
  });

  for (const name of ['search_code', 'hybrid_search', 'search_bundle']) {
    expect(name in tools, name).toBe(vectors);
  }

  for (const name of ['grep', 'read_file', 'find_symbol', 'search_graph']) {
    expect(tools).toHaveProperty(name);
  }

  expect(list).toHaveBeenCalledOnce();
});
