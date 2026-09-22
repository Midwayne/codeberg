import type { ModelMessage } from 'ai';

/** MCP tools stay out of the prompt until `load_mcp_tools` activates them
 *  (or the transcript already contains a call, which providers require to
 *  stay in the tool list). */
export function isDeferredMcpTool(name: string): boolean {
  return name.startsWith('mcp_');
}

/** Tool names sent to the model: every non-MCP tool, plus the MCP tools in
 *  `loaded`. Order follows `all`. */
export function selectActiveTools(all: readonly string[], loaded: readonly string[]): string[] {
  const keep = new Set(loaded);
  return all.filter((name) => !isDeferredMcpTool(name) || keep.has(name));
}

/** Prefixed MCP tool names already present as calls or results. */
export function mcpToolsReferenced(messages: readonly ModelMessage[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    const content = message.content;
    if (typeof content === 'string') continue;
    for (const part of content) {
      if (part.type !== 'tool-call' && part.type !== 'tool-result') continue;
      const name = part.toolName;
      if (!isDeferredMcpTool(name) || seen.has(name)) continue;
      seen.add(name);
      found.push(name);
    }
  }
  return found;
}
