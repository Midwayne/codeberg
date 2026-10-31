import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { connectMcpServer, type ConnectMcpDeps } from './client.js';
import type { McpServer } from './types.js';

type ClientConfig = Parameters<NonNullable<ConnectMcpDeps['createClient']>>[0];

/**
 * A stdio server that starts slower than the SDK's one-second discovery window
 * and, like modern Go SDK servers, treats `server/discover` as session setup.
 */
const SLOW_MODERN_SERVER = `
const { appendFileSync } = require('node:fs');
const readline = require('node:readline');

let initialized = false;

function reply(message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
}

function handle(message) {
  appendFileSync(process.env.METHOD_LOG, message.method + '\\n');

  if (message.method === 'server/discover') {
    initialized = true;
    reply({ id: message.id, result: { supportedVersions: ['2026-07-28', '2025-11-25'], capabilities: { tools: {} } } });
  } else if (message.method === 'initialize' && initialized) {
    reply({ id: message.id, error: { code: 0, message: 'duplicate "initialize" received' } });
  } else if (message.method === 'initialize') {
    initialized = true;
    reply({ id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'slow', version: '1' } } });
  } else if (message.method === 'tools/list') {
    reply({ id: message.id, result: { tools: [{ name: 'ping', inputSchema: { type: 'object' } }] } });
  }
}

let pending = [];

setTimeout(() => {
  for (const line of pending) handle(JSON.parse(line));
  pending = null;
}, 1500);

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (pending) pending.push(line);
  else handle(JSON.parse(line));
});
`;

function slowStdioServer(methodLog: string): McpServer {
  return {
    name: 'slow',
    kind: 'stdio',
    command: process.execPath,
    args: ['-e', SLOW_MODERN_SERVER],
    env: { METHOD_LOG: methodLog },
  };
}

async function capturedConfig(server: McpServer): Promise<ClientConfig> {
  const configs: ClientConfig[] = [];

  await connectMcpServer(server, {
    StdioTransport: class {} as never,
    createClient: async (config) => {
      configs.push(config);

      return { tools: async () => ({}), close: async () => {} };
    },
  });

  return configs[0]!;
}

describe('connectMcpServer protocol discovery', () => {
  it('connects to a slow-starting stdio server with a single legacy initialize', async () => {
    const methodLog = join(mkdtempSync(join(tmpdir(), 'cb-mcp-')), 'methods.log');

    const handle = await connectMcpServer(slowStdioServer(methodLog));

    try {
      expect(Object.keys(handle.tools)).toEqual(['ping']);
    } finally {
      await handle.close();
    }

    const methods = readFileSync(methodLog, 'utf8').trim().split('\n');

    expect(methods).not.toContain('server/discover');
    expect(methods.filter((method) => method === 'initialize')).toHaveLength(1);
  }, 15_000);

  it('disables protocol discovery for stdio servers', async () => {
    const config = await capturedConfig({
      name: 'local',
      kind: 'stdio',
      command: 'srv',
      args: [],
      env: {},
    });

    expect(config.protocolVersionDiscovery).toBe(false);
  });

  it.each(['http', 'sse'] as const)('keeps SDK protocol discovery for %s servers', async (kind) => {
    const config = await capturedConfig({
      name: 'remote',
      kind,
      url: 'https://example.com/mcp',
      headers: {},
    });

    expect(config).not.toHaveProperty('protocolVersionDiscovery');
    expect(config).toMatchObject({
      clientName: 'codeberg',
      initializationOptions: { timeout: 15_000 },
    });
  });
});
