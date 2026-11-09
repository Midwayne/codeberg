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

/** Which prefixed MCP tools are callable, and which of those a turn has loaded. */
export class McpToolActivation {
  private callable = new Set<string>();
  private order: string[] = [];

  reset(): void {
    this.callable = new Set();
    this.order = [];
  }

  setCallable(names: Iterable<string>): void {
    this.callable = new Set(names);
  }

  activeNames(): readonly string[] {
    return this.order;
  }

  activate(names: readonly string[]): { loaded: string[]; missing: string[] } {
    const loaded: string[] = [];
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const raw of names) {
      if (typeof raw !== 'string') continue;

      const name = raw.trim();
      if (!name || seen.has(name)) continue;

      seen.add(name);
      if (!this.callable.has(name)) {
        missing.push(name);
        continue;
      }

      if (!this.order.includes(name)) this.order.push(name);

      loaded.push(name);
    }

    return { loaded, missing };
  }

  /** Undefined when `allNames` has no deferred MCP tools. */
  select(allNames: readonly string[], messages: readonly ModelMessage[]): string[] | undefined {
    if (!allNames.some((name) => isDeferredMcpTool(name))) return undefined;

    // `order` is this process's activation log. Selection follows the transcript
    // so a pooled agent cannot keep another chat's MCP tools active.
    return selectActiveTools(allNames, [...mcpToolsReferenced(messages), ...mcpToolsLoaded(messages)]);
  }
}

/** Fields `prepareStep` should send. Undefined when the step is unchanged. */
export function prepareStepPatch(
  messages: ModelMessage[],
  next: ModelMessage[],
  activeTools: string[] | undefined,
): { messages?: ModelMessage[]; activeTools?: string[] } | undefined {
  const messagesChanged = next !== messages;
  if (!messagesChanged && !activeTools) return undefined;

  return {
    ...(messagesChanged ? { messages: next } : {}),
    ...(activeTools ? { activeTools } : {}),
  };
}

/** MCP tools a `load_mcp_tools` result in this transcript successfully loaded. */
export function mcpToolsLoaded(messages: readonly ModelMessage[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  for (const message of messages) {
    if (typeof message.content === 'string') continue;

    for (const part of message.content) {
      if (part.type !== 'tool-result' || part.toolName !== 'load_mcp_tools') continue;

      for (const name of namesLoaded(part.output)) addLoaded(found, seen, name);
    }
  }

  return found;
}

function addLoaded(found: string[], seen: Set<string>, name: string): void {
  if (!isDeferredMcpTool(name) || seen.has(name)) return;

  seen.add(name);
  found.push(name);
}

function namesLoaded(output: unknown): readonly string[] {
  const value = loadedValue(output);
  if (!value || typeof value !== 'object') return [];

  const loaded = (value as { loaded?: unknown }).loaded;

  return Array.isArray(loaded) ? loaded.filter((name): name is string => typeof name === 'string') : [];
}

function loadedValue(output: unknown): unknown {
  if (!output || typeof output !== 'object') return undefined;

  const record = output as { type?: unknown; value?: unknown; loaded?: unknown };
  if (record.type === 'json' || record.type === 'error-json') return record.value;

  if ((record.type === 'text' || record.type === 'error-text') && typeof record.value === 'string') {
    return parseJson(record.value);
  }

  return Array.isArray(record.loaded) ? record : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
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
