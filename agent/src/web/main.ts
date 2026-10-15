#!/usr/bin/env node
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { buildProjectHandler, defaultStaticRoot } from './runtime/project.js';
import { disposeProjectRuntime, installShutdown } from './runtime/shutdown.js';
import type { OwnedRuntime, ProjectRuntimeOptions } from './runtime/types.js';

import { reasoningFromEnv } from '../core/config.js';
import { writeModuleLog } from '../core/module-log.js';
import { codebergHome } from '../core/paths.js';
import { migrateProjectData, projectEnvironment, type ProjectCatalog } from '../core/projects.js';
import { defaultProviders } from '../providers/index.js';
import { ExtensionStore } from './extensions.js';
import { ModelSettingsStore } from './model-selection/settings.js';
import { createProjectRequestHandler } from './projects.js';
import { startupTitle, webEntry } from './startup.js';
import { ToolSettingsStore } from './tools/settings.js';

// Serves the interactive chat UI over HTTP. The route streams the shared
// `toolLoopAgent()`'s UI-message output
// to a browser client that owns the conversation state. The CLI's
// seeded-question flow does not apply. Model setup is required for chat,
// while the shell and documentation remain available before setup.
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

async function main(): Promise<void> {
  process.env.CODEBERG_LOG_DIR ??= join(codebergHome(), 'logs');
  const entry = webEntry();

  const providers = defaultProviders();
  const modelSettings = new ModelSettingsStore({
    defaultChat: { key: entry.modelSpec, effort: reasoningFromEnv() ?? 'provider-default' },
    defaultLearning: {
      key: entry.subagentModelSpec ?? entry.modelSpec,
      effort: 'provider-default',
    },
    availableProvider: (provider) => Boolean(providers.get(provider)),
  });

  const catalog = await loadProjectCatalog(entry.daemonUrl);
  const extensions = new ExtensionStore(codebergHome());
  const owned: OwnedRuntime[] = [];
  const tools = new ToolSettingsStore();
  void tools.current().catch((error: unknown) => writeModuleLog('agent', 'web_search_start_failed', { error: String(error) }));
  const server = createProjectServer({
    tools,
    catalog,
    entry,
    extensions,
    modelSettings,
    providers,
    owned,
    title: await startupTitle(modelSettings),
  });

  writeModuleLog('agent', 'started');

  const port = Number(process.env.CODEBERG_WEB_PORT ?? process.env.PORT ?? DEFAULT_PORT);
  server.listen(port, HOST, () => {
    console.error(`codeberg-web listening on http://${HOST}:${port}`);
  });

  installShutdown(server, owned);
}

async function loadProjectCatalog(daemonUrl: string): Promise<ProjectCatalog> {
  const response = await fetch(new URL('/projects', daemonUrl), {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Restart codeberg-d after upgrading to enable projects.');

  const catalog = (await response.json()) as ProjectCatalog;
  await migrateProjectData(codebergHome(), catalog);

  return catalog;
}

function createProjectServer(options: ProjectRuntimeOptions): Server {
  const { catalog, entry, extensions } = options;

  return createServer(
    createProjectRequestHandler({
      catalog,
      title: options.title,
      staticRoot: process.env.CODEBERG_WEB_ROOT ?? defaultStaticRoot(),
      daemonUrl: entry.daemonUrl,
      extensions: (req, res, project) =>
        extensions.route(req, res, projectEnvironment(process.env, project, catalog)),
      tools: options.tools,
      dispose: (id) => disposeProjectRuntime(options.owned, id),
      build: (project) => buildProjectHandler(project, options),
    }),
  );
}

main().catch((err: unknown) => {
  writeModuleLog('agent', 'startup_failed', { error: String(err) });
  console.error(err);
  process.exit(1);
});
