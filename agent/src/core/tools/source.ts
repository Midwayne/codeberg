import type { ToolSet } from 'ai';

/**
 * A named origin of agent tools. The Agent composes an ordered list of sources
 * into its toolset, so adding a capability — a new built-in, an MCP bridge, a
 * docs index — is a new source rather than an edit to the Agent's internals.
 */
export interface ToolSource {
  readonly name: string;
  tools(): ToolSet | Promise<ToolSet>;
}

/**
 * Merge tool sources in order. Earlier sources win on a name collision, so a
 * later source (e.g. the daemon's dynamic tools, or web tools) can never shadow
 * a core tool. This is the single place that defines the agent's tool-merge
 * policy.
 */
export async function collectTools(sources: readonly ToolSource[]): Promise<ToolSet> {
  const out: ToolSet = {};
  for (const source of sources) {
    const set = await source.tools();
    for (const [name, toolDef] of Object.entries(set)) {
      if (!(name in out)) {
        out[name] = toolDef;
      }
    }
  }
  return out;
}
