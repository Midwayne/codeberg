import type { ToolSet } from 'ai';

import { connectMcpServer, type McpClientHandle } from './client.js';
import { mcpToolName } from './names.js';
import type { ToolSource } from '../tools/source.js';
import type { McpConfig, McpServer } from './types.js';

export interface McpToolSource extends ToolSource {
  connectedServers(): string[];
  /** Raw tool names for each server that completed the MCP handshake, sorted. */
  connectedTools(): Readonly<Record<string, readonly string[]>>;
  close(): Promise<void>;
}

export interface McpToolSourceOptions {
  config: McpConfig;
  connect?: (server: McpServer) => Promise<McpClientHandle>;
  log?: (message: string) => void;
}

function annotateDescription(serverName: string, tool: unknown): unknown {
  if (!tool || typeof tool !== 'object') return tool;
  const desc =
    'description' in tool && typeof (tool as { description: unknown }).description === 'string'
      ? (tool as { description: string }).description
      : '';
  const prefix = `MCP server "${serverName}"`;
  return {
    ...(tool as object),
    description: desc ? `${prefix}: ${desc}` : prefix,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * MCP servers from `mcp.json`, as a tool source. Connection failures are
 * isolated per server so a broken config cannot take down the rest of the
 * agent. Tools are named `mcp_<server>_<tool>` so they never collide with
 * built-ins (this source is composed *last*, and collectTools also first-wins).
 */
export function mcpToolSource(opts: McpToolSourceOptions): McpToolSource {
  const log = opts.log ?? ((message: string) => console.error(message));
  const connect = opts.connect ?? ((server: McpServer) => connectMcpServer(server));
  let connected: string[] = [];
  let connectedTools: Record<string, readonly string[]> = {};
  const handles: McpClientHandle[] = [];
  let hookedExit = false;

  const source: McpToolSource = {
    name: 'mcp',
    connectedServers: () => connected,
    connectedTools: () => connectedTools,
    close: async () => {
      const pending = handles.splice(0, handles.length);
      connected = [];
      connectedTools = {};
      await Promise.all(
        pending.map(async (h) => {
          try {
            await h.close();
          } catch {
            // best-effort — process exit will reap stdio children anyway
          }
        }),
      );
    },
    tools: async (): Promise<ToolSet> => {
      connected = [];
      connectedTools = {};
      handles.length = 0;
      if (!opts.config.enabled) {
        return {};
      }
      for (const w of opts.config.warnings) {
        log(`› MCP: ${w}`);
      }
      if (opts.config.servers.length === 0) {
        return {};
      }

      const results = await Promise.allSettled(
        opts.config.servers.map(async (server) => {
          const handle = await connect(server);
          return { server, handle };
        }),
      );

      const out: ToolSet = {};
      for (let i = 0; i < results.length; i++) {
        const result = results[i]!;
        const server = opts.config.servers[i]!;
        if (result.status === 'rejected') {
          log(`› MCP: failed to connect "${server.name}": ${errorMessage(result.reason)}`);
          continue;
        }
        const { handle } = result.value;
        handles.push(handle);
        connected.push(server.name);
        const rawNames: string[] = [];
        let n = 0;
        for (const [toolName, toolDef] of Object.entries(handle.tools)) {
          rawNames.push(toolName);
          const prefixed = mcpToolName(server.name, toolName);
          if (prefixed in out) continue;
          out[prefixed] = annotateDescription(server.name, toolDef) as ToolSet[string];
          n++;
        }
        rawNames.sort();
        connectedTools[server.name] = rawNames;
        log(`› MCP: connected ${server.name} (${n} tools)`);
      }
      if (!hookedExit && handles.length > 0) {
        hookedExit = true;
        process.once('beforeExit', () => {
          void source.close();
        });
      }
      return out;
    },
  };
  return source;
}
