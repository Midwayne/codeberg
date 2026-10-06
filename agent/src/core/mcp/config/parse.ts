import type { McpInterpolateContext, McpServer } from '../types.js';
import { parseServer } from './servers.js';
import type { ParseMcpJsonOptions } from './types.js';
import { isRecord } from './values.js';

/**
 * Parse a Cursor-compatible MCP JSON document (`mcpServers`, or VS Code `servers`).
 * Invalid documents yield warnings and an empty server list rather than throwing.
 */
export function parseMcpJson(
  text: string,
  ctx: McpInterpolateContext,
  opts: ParseMcpJsonOptions = {},
): { servers: McpServer[]; warnings: string[] } {
  const warnings: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    return { servers: [], warnings: [`invalid JSON (${msg})`] };
  }

  if (!isRecord(parsed)) {
    return { servers: [], warnings: ['MCP config root must be a JSON object'] };
  }

  const fromAlias = isRecord(parsed.servers) ? parsed.servers : {};
  const fromNative = isRecord(parsed.mcpServers) ? parsed.mcpServers : {};
  // VS Code `servers` first, Cursor `mcpServers` last so a shared document
  // prefers the Cursor-native key on a name collision.
  const entries: Record<string, unknown> = { ...fromAlias, ...fromNative };

  const servers: McpServer[] = [];
  for (const [name, raw] of Object.entries(entries)) {
    const server = parseServer(name, raw, ctx, opts, warnings);
    if (server) servers.push(server);
  }

  return { servers, warnings };
}
