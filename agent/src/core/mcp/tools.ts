import { asSchema, jsonSchema, tool, type ModelMessage, type Tool, type ToolSet } from 'ai';

import type { ContextStore } from '../context/store.js';
import { safeSegment } from '../context/store.js';
import type { ToolSource } from '../tools/source.js';
import { isDeferredMcpTool, mcpToolsReferenced, selectActiveTools } from './active.js';
import {
  publishMcpCatalog,
  type CatalogDoc,
  type McpToolListing,
  type ServerCatalog,
} from './catalog.js';
import { connectMcpServer, type McpClientHandle } from './client.js';
import { mcpToolName } from './names.js';
import type { McpConfig, McpServer } from './types.js';

export type { McpToolListing };

export interface McpServerReport {
  name: string;
  state: 'connected' | 'unavailable';
  tools: readonly McpToolListing[];
  detail?: string;
  /** Absolute directory of this server's catalog files, when a context store is set. */
  catalogDir?: string;
}

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

interface Activation {
  loaded: string[];
  missing: string[];
}

/** One connected or failed server: the report, the catalog to publish, and the tools registered into the shared set. */
interface ServerSession {
  name: string;
  handle?: McpClientHandle;
  rawNames: readonly string[];
  callable: readonly string[];
  report: McpServerReport;
  catalog: ServerCatalog;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function describeTool(def: Tool): string {
  return typeof def.description === 'string' ? def.description : '';
}

function withServerDescription(serverName: string, def: Tool): Tool {
  const desc = describeTool(def);
  const prefix = `MCP server "${serverName}"`;
  def.description = desc ? `${prefix}: ${desc}` : prefix;
  return def;
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
  let connected: string[] = [];
  let connectedTools: Record<string, readonly string[]> = {};
  let reports: McpServerReport[] = [];
  let callable = new Set<string>();
  let loadedOrder: string[] = [];
  const catalogs = new Map<string, string>();
  const handles: McpClientHandle[] = [];
  let hookedExit = false;

  function activate(names: readonly string[]): Activation {
    const loaded: string[] = [];
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const raw of names) {
      if (typeof raw !== 'string') continue;
      const name = raw.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      if (!callable.has(name)) {
        missing.push(name);
        continue;
      }
      if (!loadedOrder.includes(name)) loadedOrder.push(name);
      loaded.push(name);
    }
    return { loaded, missing };
  }

  const source: McpToolSource = {
    name: 'mcp',
    connectedServers: () => connected,
    connectedTools: () => connectedTools,
    reports: () => reports,
    activeToolNames: () => [...loadedOrder],
    activeTools: (allNames, messages) => {
      if (!allNames.some((name) => isDeferredMcpTool(name))) return undefined;
      return selectActiveTools(allNames, [...loadedOrder, ...mcpToolsReferenced(messages)]);
    },
    close: async () => {
      const pending = handles.splice(0, handles.length);
      connected = [];
      connectedTools = {};
      reports = [];
      callable = new Set();
      loadedOrder = [];
      catalogs.clear();
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
      reports = [];
      callable = new Set();
      loadedOrder = [];
      catalogs.clear();
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
      const sessions: ServerSession[] = [];
      for (let i = 0; i < results.length; i++) {
        sessions.push(
          await openServer(opts.config.servers[i]!, results[i]!, out, opts.context != null, log),
        );
      }
      const published = opts.context
        ? await publishMcpCatalog(
            opts.context,
            sessions.map((session) => session.catalog),
          )
        : undefined;
      reports = sessions.map((session) => withCatalogDir(session.report, published?.dirs.get(session.name)));
      for (const session of sessions) {
        if (session.report.state === 'connected') {
          connected.push(session.name);
          connectedTools[session.name] = session.rawNames;
        }
        if (session.handle) handles.push(session.handle);
        for (const name of session.callable) callable.add(name);
      }
      if (published) {
        for (const [name, file] of published.files) catalogs.set(name, file);
      }
      if (callable.size > 0) {
        out.load_mcp_tools = loadMcpTools(activate, catalogs, reports);
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

async function openServer(
  server: McpServer,
  result: PromiseSettledResult<{ server: McpServer; handle: McpClientHandle }>,
  out: ToolSet,
  captureSchema: boolean,
  log: (message: string) => void,
): Promise<ServerSession> {
  const folder = safeSegment(server.name);
  if (result.status === 'rejected') {
    const detail = errorMessage(result.reason);
    log(`› MCP: failed to connect "${server.name}": ${detail}`);
    return {
      name: server.name,
      rawNames: [],
      callable: [],
      report: { name: server.name, state: 'unavailable', tools: [], detail },
      catalog: {
        serverName: server.name,
        folder,
        state: 'unavailable',
        detail,
        listings: [],
        docs: [],
      },
    };
  }
  const registered = await registerTools(server, result.value.handle.tools, out, captureSchema);
  log(`› MCP: connected ${server.name} (${registered.listings.length} tools)`);
  return {
    name: server.name,
    handle: result.value.handle,
    rawNames: registered.rawNames,
    callable: registered.callable,
    report: { name: server.name, state: 'connected', tools: registered.listings },
    catalog: {
      serverName: server.name,
      folder,
      state: 'connected',
      listings: registered.listings,
      docs: registered.docs,
    },
  };
}

async function registerTools(
  server: McpServer,
  defs: ToolSet,
  out: ToolSet,
  captureSchema: boolean,
): Promise<{
  rawNames: string[];
  listings: McpToolListing[];
  callable: string[];
  docs: CatalogDoc[];
}> {
  const prepared = await Promise.all(
    Object.entries(defs).map(async ([toolName, toolDef]) => {
      const prefixed = mcpToolName(server.name, toolName);
      const annotated = withServerDescription(server.name, toolDef);
      const inputSchema = captureSchema ? await readJsonSchema(annotated) : undefined;
      return { toolName, prefixed, annotated, inputSchema };
    }),
  );
  const rawNames: string[] = [];
  const listings: McpToolListing[] = [];
  const callable: string[] = [];
  const docs: CatalogDoc[] = [];
  for (const item of prepared) {
    rawNames.push(item.toolName);
    if (item.prefixed in out) continue;
    out[item.prefixed] = item.annotated;
    callable.push(item.prefixed);
    listings.push({ name: item.toolName, callable: item.prefixed });
    if (item.inputSchema !== undefined) {
      docs.push({
        toolName: item.toolName,
        callable: item.prefixed,
        json: `${JSON.stringify(
          {
            server: server.name,
            tool: item.toolName,
            callable: item.prefixed,
            description: describeTool(item.annotated),
            inputSchema: item.inputSchema,
          },
          null,
          2,
        )}\n`,
      });
    }
  }
  rawNames.sort();
  listings.sort((a, b) => a.name.localeCompare(b.name));
  return { rawNames, listings, callable, docs };
}

function withCatalogDir(report: McpServerReport, dir: string | undefined): McpServerReport {
  return dir ? { ...report, catalogDir: dir } : report;
}

function loadMcpTools(
  activate: (names: readonly string[]) => Activation,
  catalogs: Map<string, string>,
  reports: readonly McpServerReport[],
): ToolSet[string] {
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
      const result = activate(Array.isArray(names) ? names : []);
      const unavailable = reports
        .filter((report) => report.state === 'unavailable')
        .map((report) => ({ server: report.name, error: report.detail ?? 'unavailable' }));
      return {
        loaded: result.loaded,
        missing: result.missing,
        catalogs: result.loaded.flatMap((name) => {
          const file = catalogs.get(name);
          return file ? [file] : [];
        }),
        unavailable,
        note: 'Loaded tools are callable on your next step. Read a catalog file before inventing arguments.',
      };
    },
  });
}

