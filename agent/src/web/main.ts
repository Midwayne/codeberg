#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { learningEnabledFromEnv, reasoningFromEnv } from '../core/config.js';
import { DEFAULT_DAEMON_URL } from '../core/client.js';
import { entryUsage, parseEntryArgs } from '../core/entry.js';
import { LearningService } from '../core/learning/service.js';
import { codebergHome } from '../core/paths.js';
import { defaultProviders } from '../providers/index.js';
import { createWebServer } from './server.js';
import { formatWebTitle } from './title.js';
import { ModelSettingsStore } from './model-settings.js';
import { createLearningGenerator, createWebModelPool } from './model-runtime.js';

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
  let entry = parseEntryArgs(process.argv);
  if (!entry) {
    const catalog = join(codebergHome(), 'models.yml');
    const exists = await stat(catalog).then((value) => value.isFile()).catch(() => false);
    if (!exists) {
      console.error(entryUsage('codeberg-web'));
      process.exit(1);
    }
    entry = {
      modelSpec: '', question: '',
      daemonUrl: process.env.CODEBERG_DAEMON_URL ?? DEFAULT_DAEMON_URL,
    };
  }

  const providers = defaultProviders();
  const modelSettings = new ModelSettingsStore({
    defaultChat: { key: entry.modelSpec, effort: reasoningFromEnv() ?? 'provider-default' },
    defaultLearning: { key: entry.subagentModelSpec ?? entry.modelSpec, effort: 'provider-default' },
    availableProvider: (provider) => Boolean(providers.get(provider)),
  });
  const selected = await modelSettings.current();
  const learning = learningEnabledFromEnv()
    ? new LearningService({ generator: createLearningGenerator(modelSettings, (spec) => providers.resolve(spec)) })
    : false;
  const pool = createWebModelPool(entry.daemonUrl, learning);
  // Budget the (browser-held, ever-growing) transcript to the model's window on
  // every turn, using the same policy as the CLI.
  const chosen = selected.models.find((model) => model.key === selected.chat.key)!;
  const agent = await pool.forSelection({ ...selected.chat, model: chosen.model, contextWindow: chosen.contextWindow });
  const server = createWebServer({
    agent,
    learning: learning || undefined,
    modelSettings,
    selectAgent: (selection) => pool.forSelection(selection),
    title: formatWebTitle(chosen.model, selected.chat.effort),
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
    // The durable queue recovers interrupted work on the next launch.
    if (learning) learning.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.close();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('beforeExit', () => {
    if (learning) learning.stop();
    void pool.close();
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
