#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import { createAgentFromEntry } from "../core/config.js";
import { entryUsage, parseEntryArgs } from "../core/entry.js";
import { createWebServer } from "./server.js";

// The browser counterpart to `codeberg-tui`: instead of ai-sdk's terminal
// `runAgentTUI`, it serves a chat UI over HTTP. Both drive the exact same
// `toolLoopAgent()` — the web route just streams that agent's UI-message output
// to a browser client that owns the conversation state. Like the TUI, the
// the CLI's seeded-question flow does not apply; pass `provider:model`.
//
// TODO(context): the web path gets prompt caching and in-loop pruning (both ride
// on `toolLoopAgent()`), but NOT the cross-turn history compaction the TUI wires
// via `compactor`, nor the evidence ledger from `Agent.ask`. Both fight this
// path's stateless design: the route streams UI-messages through
// `pipeAgentUIStreamToResponse`, so compaction would need UI<->model message
// conversion, and the conversation-lifetime ledger can't hang off the single
// shared agent without bleeding evidence across conversations (the UI switches
// between saved sessions). Low priority — only bites a small-window local model
// over a long web chat; until then, size the window with CODEBERG_CONTEXT_WINDOW.
//
// The port defaults to an uncommon high one (rather than the much-contended
// 3000) so it rarely collides with another dev server, while staying below the
// 49152+ ephemeral range so the OS won't have handed it to a transient client.
// It sits just past the daemon's 48080 so codeberg's two ports group together.
// Override with CODEBERG_WEB_PORT (the launcher sets it) or PORT.
const DEFAULT_PORT = 48088;
const HOST = "127.0.0.1";

// The built React SPA lives at `web-ui/dist`, one level up from this bundle
// (`dist/web.js`). Override with CODEBERG_WEB_ROOT; if it is unbuilt, the server
// falls back to the embedded dependency-free page.
function defaultStaticRoot(): string {
  return fileURLToPath(new URL("../web-ui/dist", import.meta.url));
}

async function main(): Promise<void> {
  const entry = parseEntryArgs(process.argv);
  if (!entry) {
    console.error(entryUsage("codeberg-web"));
    process.exit(1);
  }

  const agent = await createAgentFromEntry(entry).toolLoopAgent();
  const server = createWebServer({
    agent,
    title: `codeberg · ${entry.modelSpec} · ${entry.daemonUrl}`,
    staticRoot: process.env.CODEBERG_WEB_ROOT ?? defaultStaticRoot(),
  });

  const port = Number(
    process.env.CODEBERG_WEB_PORT ?? process.env.PORT ?? DEFAULT_PORT,
  );
  server.listen(port, HOST, () => {
    console.error(`codeberg-web listening on http://${HOST}:${port}`);
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
