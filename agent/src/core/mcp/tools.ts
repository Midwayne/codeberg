import { asSchema, jsonSchema, tool, type ModelMessage, type ToolSet } from 'ai';
import { dirname } from 'node:path';

import type { ContextStore } from '../context/store.js';
import { safeSegment } from '../context/store.js';
import type { ToolSource } from '../tools/source.js';
import { isDeferredMcpTool, mcpToolsReferenced, selectActiveTools } from './active.js';
import { connectMcpServer, type McpClientHandle } from './client.js';
import { mcpToolName } from './names.js';
import type { McpConfig, McpServer } from './types.js';

export interface McpToolListing {
  name: string;
  callable: string;
}

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

interface CatalogDoc {
  toolName: string;
  callable: string;
  json: string;
}

interface ServerCatalog {
  folder: string;
  state: 'connected' | 'unavailable';
  detail?: string;
  listings: McpToolListing[];
  docs: CatalogDoc[];
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

function readDescription(toolDef: unknown): string {
  if (!toolDef || typeof toolDef !== 'object') return '';
  const description = (toolDef as { description?: unknown }).description;
  return typeof description === 'string' ? description : '';
}

async function readJsonSchema(toolDef: unknown): Promise<unknown> {
  if (!toolDef || typeof toolDef !== 'object') return {};
  const schema = (toolDef as { inputSchema?: unknown }).inputSchema;
  if (schema == null) return {};
  try {
    const converted = asSchema(schema as Parameters<typeof asSchema>[0]);
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

      const context = opts.context;
      const pending: ServerCatalog[] = [];
      const out: ToolSet = {};
      for (let i = 0; i < results.length; i++) {
        const result = results[i]!;
        const server = opts.config.servers[i]!;
        const folder = safeSegment(server.name);
        if (result.status === 'rejected') {
          const detail = errorMessage(result.reason);
          log(`› MCP: failed to connect "${server.name}": ${detail}`);
          reports.push({
            name: server.name,
            state: 'unavailable',
            tools: [],
            detail,
          });
          pending.push({ folder, state: 'unavailable', detail, listings: [], docs: [] });
          continue;
        }
        const { handle } = result.value;
        handles.push(handle);
        connected.push(server.name);
        const rawNames: string[] = [];
        const listings: McpToolListing[] = [];
        const docs: CatalogDoc[] = [];
        const prepared = await Promise.all(
          Object.entries(handle.tools).map(async ([toolName, toolDef]) => {
            const prefixed = mcpToolName(server.name, toolName);
            const annotated = annotateDescription(server.name, toolDef) as ToolSet[string];
            const inputSchema = context ? await readJsonSchema(annotated) : undefined;
            return { toolName, prefixed, annotated, inputSchema };
          }),
        );
        for (const item of prepared) {
          rawNames.push(item.toolName);
          if (item.prefixed in out) continue;
          out[item.prefixed] = item.annotated;
          callable.add(item.prefixed);
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
                  description: readDescription(item.annotated),
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
        connectedTools[server.name] = rawNames;
        reports.push({
          name: server.name,
          state: 'connected',
          tools: listings,
        });
        pending.push({ folder, state: 'connected', listings, docs });
        log(`› MCP: connected ${server.name} (${listings.length} tools)`);
      }
      if (context && pending.length > 0) {
        const published = await publishMcpCatalog(context, pending);
        for (const [name, file] of published.catalogs) catalogs.set(name, file);
        for (let i = 0; i < reports.length; i++) {
          const dir = published.dirs.get(pending[i]!.folder);
          const report = reports[i];
          if (dir && report) report.catalogDir = dir;
        }
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

/** Write every server's JSON, TOOLS.txt, and STATUS.txt. `context` is required. */
async function publishMcpCatalog(
  context: ContextStore,
  entries: readonly ServerCatalog[],
): Promise<{ catalogs: Map<string, string>; dirs: Map<string, string> }> {
  const catalogs = new Map<string, string>();
  const dirs = new Map<string, string>();
  await Promise.all(
    entries.map(async (entry) => {
      const files: { rel: string; body: string; callable?: string }[] = [];
      switch (entry.state) {
        case 'unavailable':
          files.push({
            rel: `mcp/${entry.folder}/STATUS.txt`,
            body: `state: unavailable\nerror: ${entry.detail ?? ''}\n`,
          });
          break;
        case 'connected': {
          const lines = [
            'state: connected',
            ...entry.listings.map((listing) => `${listing.name}\t${listing.callable}`),
            '',
          ];
          files.push(
            { rel: `mcp/${entry.folder}/TOOLS.txt`, body: lines.join('\n') },
            { rel: `mcp/${entry.folder}/STATUS.txt`, body: 'state: connected\n' },
            ...entry.docs.map((doc) => ({
              rel: `mcp/${entry.folder}/${safeSegment(doc.toolName)}.json`,
              body: doc.json,
              callable: doc.callable,
            })),
          );
          break;
        }
        default: {
          const _never: never = entry.state;
          throw new Error(_never);
        }
      }
      const written = await Promise.all(
        files.map(async (file) => {
          const abs = await context.writeRel(file.rel, file.body);
          return { abs, callable: file.callable };
        }),
      );
      const first = written[0]?.abs;
      if (first) dirs.set(entry.folder, dirname(first));
      for (const file of written) {
        if (file.callable) catalogs.set(file.callable, file.abs);
      }
    }),
  );
  return { catalogs, dirs };
}
