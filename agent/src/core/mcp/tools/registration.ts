import { asSchema, type Tool, type ToolSet } from 'ai';
import type { CatalogTool } from '../catalog.js';
import type { McpClientHandle } from '../client.js';
import { mcpToolName } from '../names.js';
import type { McpServer } from '../types.js';
import type { OpenedServer } from './state.js';

export async function openServer(
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

export async function registerTools(
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

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function describeTool(def: Tool): string {
  return typeof def.description === 'string' ? def.description : '';
}

/** A new tool object. The client's definition keeps its original description. */
export function copyWithServerDescription(serverName: string, def: Tool): Tool {
  const desc = describeTool(def);
  const prefix = `MCP server "${serverName}"`;
  const description = desc ? `${prefix}: ${desc}` : prefix;

  return { ...def, description } as Tool;
}

export async function readJsonSchema(def: Tool): Promise<unknown> {
  const schema = def.inputSchema;
  if (schema == null) return {};

  try {
    const converted = asSchema(schema);

    return (await converted.jsonSchema) ?? {};
  } catch {
    return {};
  }
}
