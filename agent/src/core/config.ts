import { Agent } from "./agent.js";
import { DaemonClient } from "./client.js";
import { defaultProviders } from "../providers/index.js";
import type { EntryConfig } from "./entry.js";

export interface AgentConfig {
  modelSpec: string;
  daemonUrl: string;
}

export function createAgent(config: AgentConfig): Agent {
  const registry = defaultProviders();
  const model = registry.resolve(config.modelSpec);
  return new Agent({
    model,
    daemon: new DaemonClient(config.daemonUrl),
  });
}

export function createAgentFromEntry(entry: EntryConfig): Agent {
  return createAgent({
    modelSpec: entry.modelSpec,
    daemonUrl: entry.daemonUrl,
  });
}
