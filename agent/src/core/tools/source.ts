import type { ToolSet } from 'ai';

/**
 * A named origin of agent tools. The Agent composes an ordered list of sources
 * into its toolset, so adding a capability — a new built-in, an MCP bridge, a
 * docs index — is a new source rather than an edit to the Agent's internals.
 */
export interface ToolSource {
  readonly name: string;
  /**
   * `earlier` holds the tools of the sources composed before this one.
   * Optional so a source that does not look at them can keep `tools()`.
   */
  tools(earlier?: ToolSet): ToolSet | Promise<ToolSet>;
  /** System-prompt section that applies whenever the source registers a tool. */
  readonly instructions?: string;
  /** False for tools with side effects or per-turn state, which keep their own calls instead of joining `batch`. */
  readonly batchable?: boolean;
  /** Tools that may wait indefinitely (a delegated browser), so the agent drops its run-wide deadline. */
  readonly untimed?: boolean;
  /** Registered only for a server-owned chat. The CLI ask path omits these. */
  readonly serverOnly?: boolean;
}

export interface ComposedTools {
  tools: ToolSet;
  /** Instructions of the sources that registered tools, in source order. */
  instructions: string[];
  /** Names `batch` may run. */
  batchable: string[];
  untimed: boolean;
}

/**
 * Merge tool sources in order. Earlier sources win on a name collision, so a
 * later source (e.g. the daemon's dynamic tools, or web tools) can never shadow
 * a core tool. This is the single place that defines the agent's tool-merge
 * policy.
 */
export async function composeTools(
  sources: readonly ToolSource[],
  options?: { server?: boolean },
): Promise<ComposedTools> {
  const out: ComposedTools = { tools: {}, instructions: [], batchable: [], untimed: false };

  for (const source of sources) {
    if (source.serverOnly && !options?.server) continue;

    const added = Object.entries(await source.tools({ ...out.tools })).filter(([name]) => !(name in out.tools));
    if (added.length === 0) continue;

    for (const [name, toolDef] of added) out.tools[name] = toolDef;

    if (source.instructions) out.instructions.push(source.instructions);
    if (source.batchable !== false) out.batchable.push(...added.map(([name]) => name));
    if (source.untimed) out.untimed = true;
  }

  return out;
}

export async function collectTools(sources: readonly ToolSource[]): Promise<ToolSet> {
  return (await composeTools(sources)).tools;
}

/** Attach metadata to a source owned by another feature. */
export function withToolMetadata(
  source: ToolSource,
  metadata: Pick<ToolSource, 'instructions' | 'batchable' | 'untimed' | 'serverOnly'>,
): ToolSource {
  return { ...metadata, name: source.name, tools: (earlier) => source.tools(earlier) };
}
