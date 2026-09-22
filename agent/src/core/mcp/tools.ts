import { asSchema, jsonSchema, tool, type ModelMessage, type Tool, type ToolSet } from 'ai';

import type { ContextStore } from '../context/store.js';
import type { ToolSource } from '../tools/source.js';
import { McpToolActivation } from './active.js';
import {
  publishMcpCatalog,
  serverReport,
  type CatalogTool,
  type McpServerReport,
  type McpToolListing,
  type PublishedCatalog,
  type ServerCatalog,
} from './catalog.js';
import { connectMcpServer, type McpClientHandle } from './client.js';
import { mcpToolName } from './names.js';
import type { McpConfig, McpServer } from './types.js';

export type { McpServerReport, McpToolListing };

export interface McpToolSource extends ToolSource {
  connectedServers(): string[];
  /** Raw tool names for each server that completed the MCP handshake, sorted. */
  connectedTools(): Readonly<Record<string, readonly string[]>>;
  /** Connected and unavailable servers, in config order. */
  reports(): readonly McpServerReport[];
  /** Prefixed MCP tools currently activated for the model. */
  activeToolNames(): readonly string[];
  /**
   * Names to send on this step. Undefined when `allNames` has no deferred
   * MCP tools; otherwise every non-MCP tool plus loaded and transcript-referenced
   * MCP tools.
   */
  activeTools(allNames: readonly string[], messages: readonly ModelMessage[]): string[] | undefined;
  close(): Promise<void>;
}

export interface McpToolSourceOptions {
  config: McpConfig;
  connect?: (server: McpServer) => Promise<McpClientHandle>;
  log?: (message: string) => void;
  /** When set, each server's tools are written under `mcp/<server>/`. */
  context?: ContextStore;
}

/** One handshake. The catalog is the record; the handle is how we close it. */
interface OpenedServer {
  handle?: McpClientHandle;
  /** Every raw tool name from the server, including sanitized-name collisions. */
  rawNames: readonly string[];
  catalog: ServerCatalog;
}

interface SourceState {
  opened: OpenedServer[];
  published?: PublishedCatalog;
  readonly activation: McpToolActivation;
}

function blankState(): SourceState {
  return { opened: [], activation: new McpToolActivation() };
}

function resetState(state: SourceState): void {
  state.opened = [];
  state.published = undefined;
  state.activation.reset();
}

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
  const connect = opts.connect ?? ((server: McpServer) => connectMcpServer(server));
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
    close: async () => {
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
    },
    tools: async (): Promise<ToolSet> => {
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
        state.opened.push(await openServer(opts.config.servers[i]!, results[i]!, out, captureSchema, log));
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
      if (state.opened.some((opened) => opened.catalog.tools.length > 0)) {
        out.load_mcp_tools = loadMcpTools(state);
      }
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

async function openServer(
  server: McpServer,
  result: PromiseSettledResult<{ server: McpServer; handle: McpClientHandle }>,
  out: ToolSet,
  captureSchema: boolean,
  log: (message: string) => void,
): Promise<OpenedServer> {
  if (result.status === 'rejected') {
    const detail = errorMessage(result.reason);
    log(`› MCP: failed to connect "${server.name}": ${detail}`);
    return {
      rawNames: [],
      catalog: { serverName: server.name, state: 'unavailable', detail, tools: [] },
    };
  }
  const registered = await registerTools(server, result.value.handle.tools, out, captureSchema);
  log(`› MCP: connected ${server.name} (${registered.tools.length} tools)`);
  return {
    handle: result.value.handle,
    rawNames: registered.rawNames,
    catalog: { serverName: server.name, state: 'connected', tools: registered.tools },
  };
}

async function registerTools(
  server: McpServer,
  defs: ToolSet,
  out: ToolSet,
  captureSchema: boolean,
): Promise<{ rawNames: string[]; tools: CatalogTool[] }> {
  const prepared = await Promise.all(
    Object.entries(defs).map(async ([toolName, toolDef]) => {
      const prefixed = mcpToolName(server.name, toolName);
      const annotated = copyWithServerDescription(server.name, toolDef);
      const inputSchema = captureSchema ? await readJsonSchema(toolDef) : undefined;
      return { toolName, prefixed, annotated, inputSchema };
    }),
  );
  const rawNames: string[] = [];
  const tools: CatalogTool[] = [];
  for (const item of prepared) {
    rawNames.push(item.toolName);
    if (item.prefixed in out) continue;
    out[item.prefixed] = item.annotated;
    tools.push({
      name: item.toolName,
      callable: item.prefixed,
      description: describeTool(item.annotated),
      ...(item.inputSchema !== undefined ? { inputSchema: item.inputSchema } : {}),
    });
  }
  rawNames.sort();
  tools.sort((a, b) => a.name.localeCompare(b.name));
  return { rawNames, tools };
}

function loadMcpTools(state: SourceState): ToolSet[string] {
  return tool({
    description:
      'Activate MCP tools so they can be called on the next step. Pass callable names ' +
      '(mcp_<server>_<tool>). Read the server folder or a tool JSON file first when the ' +
      'name alone does not tell you the arguments. Unavailable servers are listed in the ' +
      'prompt; do not expect their tools to load.',
    inputSchema: jsonSchema<{ names: string[] }>({
      type: 'object',
      properties: {
        names: {
          type: 'array',
          items: { type: 'string' },
          description: 'Callable MCP tool names, for example mcp_github_list_issues.',
        },
      },
      required: ['names'],
    }),
    execute: async ({ names }) => {
      const result = state.activation.activate(Array.isArray(names) ? names : []);
      const unavailable = state.opened
        .filter((opened) => opened.catalog.state === 'unavailable')
        .map((opened) => ({
          server: opened.catalog.serverName,
          error: opened.catalog.detail ?? 'unavailable',
        }));
      return {
        loaded: result.loaded,
        missing: result.missing,
        catalogs: result.loaded.flatMap((name) => {
          const file = state.published?.files.get(name);
          return file ? [file] : [];
        }),
        unavailable,
        note: 'Loaded tools are callable on your next step. Read a catalog file before inventing arguments.',
      };
    },
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function describeTool(def: Tool): string {
  return typeof def.description === 'string' ? def.description : '';
}

/** A new tool object. The client's definition keeps its original description. */
function copyWithServerDescription(serverName: string, def: Tool): Tool {
  const desc = describeTool(def);
  const prefix = `MCP server "${serverName}"`;
  const description = desc ? `${prefix}: ${desc}` : prefix;
  return { ...def, description } as Tool;
}

async function readJsonSchema(def: Tool): Promise<unknown> {
  const schema = def.inputSchema;
  if (schema == null) return {};
  try {
    const converted = asSchema(schema);
    return (await converted.jsonSchema) ?? {};
  } catch {
    return {};
  }
}
