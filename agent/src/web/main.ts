#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

import { createAgentFromEntry, reasoningFromEnv } from '../core/config.js';
import { wrapToolLoopAgentWithCompaction } from '../core/compaction.js';
import { entryUsage, parseEntryArgs } from '../core/entry.js';
import { createWebServer } from './server.js';
import { formatWebTitle } from './title.js';

// Serves the interactive chat UI over HTTP. The route streams the shared
// `toolLoopAgent()`'s UI-message output
// to a browser client that owns the conversation state. The CLI's
// seeded-question flow does not apply; pass `provider:model`.
//
// The web path now gets prompt caching, in-loop pruning (both ride on
// `toolLoopAgent()`), AND cross-turn history compaction — the browser holds the
// full conversation and re-sends it each turn, so the agent wraps the loop with
// `wrapToolLoopAgentWithCompaction` to keep it under the model's window.
//
// Still missing (by design): the conversation-lifetime evidence ledger from
// `Agent.ask`. It can't hang off the single shared agent without bleeding
// evidence across conversations — the UI switches between saved sessions, which
// are stateless on the server — so it stays a CLI-only optimization.
//
// The port defaults to an uncommon high one (rather than the much-contended
// 3000) so it rarely collides with another dev server, while staying below the
// 49152+ ephemeral range so the OS won't have handed it to a transient client.
// It sits just past the daemon's 48080 so codeberg's two ports group together.
// Override with CODEBERG_WEB_PORT (the launcher sets it) or PORT.
const DEFAULT_PORT = 48088;
const HOST = '127.0.0.1';

// The built React SPA lives at `web-ui/dist`, one level up from this bundle
// (`dist/web.js`). Override with CODEBERG_WEB_ROOT; if it is unbuilt, the server
// falls back to the embedded dependency-free page.
function defaultStaticRoot(): string {
  return fileURLToPath(new URL('../web-ui/dist', import.meta.url));
}

async function main(): Promise<void> {
  const entry = parseEntryArgs(process.argv);
  if (!entry) {
    console.error(entryUsage('codeberg-web'));
    process.exit(1);
  }

  const core = createAgentFromEntry(entry);
  const loop = await core.toolLoopAgent();
  // Budget the (browser-held, ever-growing) transcript to the model's window on
  // every turn, using the same policy as the CLI.
  const agent = wrapToolLoopAgentWithCompaction(loop, core.historyCompactor());
  const server = createWebServer({
    agent,
    learning: core.learningService(),
    title: formatWebTitle(entry.modelSpec, reasoningFromEnv()),
    staticRoot: process.env.CODEBERG_WEB_ROOT ?? defaultStaticRoot(),
  });

  const port = Number(process.env.CODEBERG_WEB_PORT ?? process.env.PORT ?? DEFAULT_PORT);
  server.listen(port, HOST, () => {
    console.error(`codeberg-web listening on http://${HOST}:${port}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      process.exit(signal === 'SIGINT' ? 130 : 143);
    }
    shuttingDown = true;
    const learning = core.learningService();
    if (learning.isWorking() && process.stdin.isTTY && process.stdout.isTTY) {
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await prompt.question(
          '1 knowledge update is still being processed. [W]ait / [E]xit anyway: ',
        );
        if (answer.trim().toLowerCase().startsWith('w')) {
          await learning.waitForCurrent();
        }
      } finally {
        prompt.close();
      }
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await core.close();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('beforeExit', () => {
    void core.close();
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
