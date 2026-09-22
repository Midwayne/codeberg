import { asSchema, jsonSchema, tool, type ToolSet } from 'ai';
import { dirname } from 'node:path';

import type { ContextStore } from '../context/store.js';
import { safeSegment } from '../context/store.js';
import type { ToolSource } from '../tools/source.js';
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
      for (let i = 0; i < results.length; i++) {
        const result = results[i]!;
        const server = opts.config.servers[i]!;
        const folder = safeSegment(server.name);
        if (result.status === 'rejected') {
          const detail = errorMessage(result.reason);
          log(`› MCP: failed to connect "${server.name}": ${detail}`);
          const catalogDir = await writeStatus(opts.context, folder, `state: unavailable\nerror: ${detail}\n`);
          reports.push({
            name: server.name,
            state: 'unavailable',
            tools: [],
            detail,
            catalogDir,
          });
          continue;
        }
        const { handle } = result.value;
        handles.push(handle);
        connected.push(server.name);
        const rawNames: string[] = [];
        const listings: McpToolListing[] = [];
        let n = 0;
        for (const [toolName, toolDef] of Object.entries(handle.tools)) {
          rawNames.push(toolName);
          const prefixed = mcpToolName(server.name, toolName);
          if (prefixed in out) continue;
          const annotated = annotateDescription(server.name, toolDef) as ToolSet[string];
          out[prefixed] = annotated;
          callable.add(prefixed);
          listings.push({ name: toolName, callable: prefixed });
          n++;
          if (opts.context) {
            const doc = {
              server: server.name,
              tool: toolName,
              callable: prefixed,
              description: readDescription(annotated),
              inputSchema: await readJsonSchema(annotated),
            };
            const file = await opts.context.writeRel(
              `mcp/${folder}/${safeSegment(toolName)}.json`,
              `${JSON.stringify(doc, null, 2)}\n`,
            );
            catalogs.set(prefixed, file);
          }
        }
        rawNames.sort();
        listings.sort((a, b) => a.name.localeCompare(b.name));
        connectedTools[server.name] = rawNames;
        const catalogDir = await writeServerCatalog(opts.context, folder, listings);
        reports.push({
          name: server.name,
          state: 'connected',
          tools: listings,
          catalogDir,
        });
        log(`› MCP: connected ${server.name} (${n} tools)`);
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

async function writeStatus(
  context: ContextStore | undefined,
  folder: string,
  body: string,
): Promise<string | undefined> {
  if (!context) return undefined;
  const file = await context.writeRel(`mcp/${folder}/STATUS.txt`, body);
  return dirname(file);
}

async function writeServerCatalog(
  context: ContextStore | undefined,
  folder: string,
  listings: readonly McpToolListing[],
): Promise<string | undefined> {
  if (!context) return undefined;
  const lines = [
    'state: connected',
    ...listings.map((listing) => `${listing.name}\t${listing.callable}`),
    '',
  ];
  const index = await context.writeRel(`mcp/${folder}/TOOLS.txt`, lines.join('\n'));
  await context.writeRel(`mcp/${folder}/STATUS.txt`, 'state: connected\n');
  return dirname(index);
}
