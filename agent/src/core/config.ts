import { Agent } from "./agent.js";
import { DaemonClient } from "./client.js";
import { defaultProviders } from "../providers/index.js";
import { profileFor } from "../providers/profiles.js";
import type { EntryConfig } from "./entry.js";
import type { ReasoningEffort } from "./types.js";

export interface AgentConfig {
  modelSpec: string;
  daemonUrl: string;
  reasoning?: ReasoningEffort;
}

const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  "provider-default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

/** Read CODEBERG_REASONING, accepting only the ai-sdk v7 effort levels. */
export function reasoningFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ReasoningEffort | undefined {
  const value = env.CODEBERG_REASONING;
  return value && (REASONING_EFFORTS as string[]).includes(value)
    ? (value as ReasoningEffort)
    : undefined;
}

export function createAgent(config: AgentConfig): Agent {
  const registry = defaultProviders();
  const model = registry.resolve(config.modelSpec);
  return new Agent({
    model,
    daemon: new DaemonClient(config.daemonUrl),
    reasoning: config.reasoning,
    // Resolve the model's memory limit + caching strategy from the same spec so
    // the agent budgets context and marks the cache prefix correctly.
    profile: profileFor(config.modelSpec),
  });
}

export function createAgentFromEntry(entry: EntryConfig): Agent {
  return createAgent({
    modelSpec: entry.modelSpec,
    daemonUrl: entry.daemonUrl,
    reasoning: reasoningFromEnv(),
  });
}
