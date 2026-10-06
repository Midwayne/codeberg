import type { ToolSet } from 'ai';
import { loadMcpTools } from './tools/activation.js';
import { openServer } from './tools/registration.js';
import {
  type McpToolSource,
  type McpToolSourceOptions,
  type SourceState,
  blankState,
  resetState,
} from './tools/state.js';

import {
  publishMcpCatalog,
  serverReport,
  type McpServerReport,
  type McpToolListing,
} from './catalog.js';
import { connectMcpServer } from './client.js';
import type { McpServer } from './types.js';

export type { McpServerReport, McpToolListing };

/**
 * MCP servers from `mcp.json`, as a tool source. Connection failures are
 * isolated per server so a broken config cannot take down the rest of the
 * agent. Tools are named `mcp_<server>_<tool>` so they never collide with
 * built-ins (this source is composed *last*, and collectTools also first-wins).
 *
 * The tools are registered here, but the agent withholds them from the model
 * until `load_mcp_tools` activates the ones a turn needs. Full descriptions
 * and argument schemas are written under the context store, one folder per
 * server, so they are not inlined into every prompt.
 */
export function mcpToolSource(opts: McpToolSourceOptions): McpToolSource {
  const log = opts.log ?? ((message: string) => console.error(message));
  const state = blankState();
  let hookedExit = false;

  function reports(): McpServerReport[] {
    return state.opened.map((opened) =>
      serverReport(opened.catalog, state.published?.dirs.get(opened.catalog.serverName)),
    );
  }

  const source: McpToolSource = {
    name: 'mcp',
    connectedServers: () =>
      state.opened
        .filter((opened) => opened.catalog.state === 'connected')
        .map((opened) => opened.catalog.serverName),
    connectedTools: () => {
      const out: Record<string, readonly string[]> = {};
      for (const opened of state.opened) {
        if (opened.catalog.state === 'connected') out[opened.catalog.serverName] = opened.rawNames;
      }

      return out;
    },
    reports,
    activeToolNames: () => state.activation.activeNames(),
    activeTools: (allNames, messages) => state.activation.select(allNames, messages),
    close: () => closeServers(state),
    tools: async (): Promise<ToolSet> => {
      const out = await loadServers(state, opts, log);

      if (!hookedExit && state.opened.some((opened) => opened.handle)) {
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

async function closeServers(state: SourceState): Promise<void> {
  const pending = state.opened.flatMap((opened) => (opened.handle ? [opened.handle] : []));
  resetState(state);
  await Promise.all(
    pending.map(async (handle) => {
      try {
        await handle.close();
      } catch {
        // best-effort — process exit will reap stdio children anyway
      }
    }),
  );
}

async function loadServers(
  state: SourceState,
  opts: McpToolSourceOptions,
  log: (message: string) => void,
): Promise<ToolSet> {
  const connect = opts.connect ?? ((server: McpServer) => connectMcpServer(server));

  resetState(state);
  if (!opts.config.enabled) return {};

  for (const warning of opts.config.warnings) log(`› MCP: ${warning}`);

  if (opts.config.servers.length === 0) return {};

  const results = await Promise.allSettled(
    opts.config.servers.map(async (server) => {
      const handle = await connect(server);

      return { server, handle };
    }),
  );

  const out: ToolSet = {};
  const captureSchema = opts.context != null;
  for (let i = 0; i < results.length; i++) {
    state.opened.push(
      await openServer(opts.config.servers[i]!, results[i]!, out, captureSchema, log),
    );
  }

  if (opts.context) {
    state.published = await publishMcpCatalog(
      opts.context,
      state.opened.map((opened) => opened.catalog),
    );
  }

  state.activation.setCallable(
    state.opened.flatMap((opened) => opened.catalog.tools.map((entry) => entry.callable)),
  );
  if (state.opened.length > 0) {
    out.load_mcp_tools = loadMcpTools(state);
  }

  return out;
}

export type { McpToolSource, McpToolSourceOptions } from './tools/state.js';
