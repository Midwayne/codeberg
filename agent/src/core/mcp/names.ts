const MAX_TOOL_NAME = 64;

function sanitize(s: string): string {
  return s
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Stable, provider-safe tool name for an MCP tool. Anthropic (and others) limit
 * names to `[A-Za-z0-9_-]{1,64}`, so we prefix `mcp_<server>_` and sanitize.
 */
export function mcpToolName(server: string, tool: string): string {
  const s = sanitize(server) || 'server';
  const t = sanitize(tool) || 'tool';
  const name = `mcp_${s}_${t}`;
  if (name.length <= MAX_TOOL_NAME) return name;
  const prefix = `mcp_${s}_`;
  const budget = MAX_TOOL_NAME - prefix.length;
  if (budget < 8) {
    return `mcp_${shortHash(`${server}:${tool}`)}`.slice(0, MAX_TOOL_NAME);
  }
  return prefix + t.slice(0, budget);
}
