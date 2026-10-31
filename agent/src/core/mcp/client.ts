import { createMCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import type { ToolSet } from 'ai';

import type { McpServer } from './types.js';

const INIT_TIMEOUT_MS = 15_000;

export interface McpClientHandle {
  tools: ToolSet;
  close: () => Promise<void>;
}

interface McpClientLike {
  tools: () => Promise<ToolSet> | ToolSet;
  close: () => Promise<void>;
}

export interface ConnectMcpDeps {
  createClient?: (config: {
    transport: unknown;
    clientName?: string;
    initializationOptions?: { timeout?: number };
    protocolVersionDiscovery?: boolean;
  }) => Promise<McpClientLike>;
  StdioTransport?: new (opts: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
  }) => unknown;
}

/**
 * Local servers can start slower than the SDK's one-second discovery window.
 * Its fallback `initialize` then races the late discovery reply, and servers
 * that treat discovery as session setup reject it as a duplicate. Remote
 * servers keep the SDK default.
 */
function discoveryOptions(server: McpServer): { protocolVersionDiscovery?: false } {
  return server.kind === 'stdio' ? { protocolVersionDiscovery: false } : {};
}

function neverKind(x: never): never {
  throw new Error(`unexpected MCP transport: ${String(x)}`);
}

/**
 * Open one configured MCP server via the AI SDK client. Stdio servers spawn a
 * local process; http/sse servers use the SDK's built-in transports.
 */
export async function connectMcpServer(
  server: McpServer,
  deps: ConnectMcpDeps = {},
): Promise<McpClientHandle> {
  const createClient = deps.createClient ?? (createMCPClient as ConnectMcpDeps['createClient'])!;
  const StdioTransport = deps.StdioTransport ?? Experimental_StdioMCPTransport;

  let transport: unknown;
  switch (server.kind) {
    case 'stdio':
      transport = new StdioTransport({
        command: server.command,
        args: server.args,
        env: server.env,
        cwd: server.cwd,
      });
      break;
    case 'http':
    case 'sse':
      transport = {
        type: server.kind,
        url: server.url,
        ...(Object.keys(server.headers).length > 0 ? { headers: server.headers } : {}),
      };
      break;
    default:
      return neverKind(server);
  }

  const client = await createClient({
    transport,
    clientName: 'codeberg',
    initializationOptions: { timeout: INIT_TIMEOUT_MS },
    ...discoveryOptions(server),
  });

  const tools = await client.tools();

  return { tools, close: () => client.close() };
}
