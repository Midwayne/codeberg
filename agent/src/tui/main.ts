#!/usr/bin/env node
import { runAgentTUI } from '@ai-sdk/tui';

import { createAgentFromEntry } from '../core/config.js';
import { entryUsage, parseEntryArgs } from '../core/entry.js';
import { SessionStore } from './session-store.js';
import { wrapSessionAgent } from './session-agent.js';

// The interactive chat UI is provided by ai-sdk v7's `runAgentTUI`, which drives
// the ToolLoopAgent itself and renders streamed tool calls, reasoning, and
// output-throughput stats. It owns input and session state, so the CLI's
// seeded-question flow does not apply here — pass only `provider:model`.
//
// `runAgentTUI` exposes no session or input hooks, so persistence and slash
// commands are layered onto the one seam it does give us — the `agent` it calls
// every turn. `wrapSessionAgent` rewrites that turn's prompt, answers `/help`,
// `/sessions`, `/resume` and `/new` locally, and saves each chat under
// ~/.codeberg/sessions so it can be resumed later.
async function main(): Promise<void> {
  const entry = parseEntryArgs(process.argv);
  if (!entry) {
    console.error(entryUsage('codeberg-tui'));
    process.exit(1);
  }

  const core = createAgentFromEntry(entry);
  const loop = await core.toolLoopAgent();
  const agent = wrapSessionAgent(loop, {
    store: new SessionStore(),
    modelSpec: entry.modelSpec,
    // Same memory-limit-aware compaction the CLI path uses, applied to the
    // TUI's separately-driven transcript.
    compactor: core.historyCompactor(),
  });

  await runAgentTUI({
    agent,
    title: `codeberg · ${entry.modelSpec} · ${entry.daemonUrl} · /help for commands`,
    tools: 'auto-collapsed',
    reasoning: 'auto-collapsed',
    responseStatistics: 'outputTokensPerSecond',
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
