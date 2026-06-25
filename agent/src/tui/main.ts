#!/usr/bin/env node
import { runAgentTUI } from "@ai-sdk/tui";

import { createAgentFromEntry } from "../core/config.js";
import { entryUsage, parseEntryArgs } from "../core/entry.js";

// The interactive chat UI is provided by ai-sdk v7's `runAgentTUI`, which drives
// the ToolLoopAgent itself and renders streamed tool calls, reasoning, and
// output-throughput stats. It owns input and session state, so the legacy
// `--once` / seeded `--question` flags do not apply here (use the CLI for those).
async function main(): Promise<void> {
  const entry = parseEntryArgs(process.argv);
  if (!entry) {
    console.error(entryUsage("codeberg-tui"));
    process.exit(1);
  }

  const agent = await createAgentFromEntry(entry).toolLoopAgent();

  await runAgentTUI({
    agent,
    title: `codeberg · ${entry.modelSpec} · ${entry.daemonUrl}`,
    tools: "auto-collapsed",
    reasoning: "auto-collapsed",
    responseStatistics: "outputTokensPerSecond",
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
