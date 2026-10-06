#!/usr/bin/env node
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeAgentUIStreamToResponse } from 'ai';

import { learningEnabledFromEnv, reasoningFromEnv } from '../core/config.js';
import { DEFAULT_DAEMON_URL } from '../core/client.js';
import { entryUsage, parseEntryArgs } from '../core/entry.js';
import { LearningService } from '../core/learning/service.js';
import { writeModuleLog } from '../core/module-log.js';
import {
  migrateProjectData,
  projectDataHome,
  projectEnvironment,
  type Project,
  type ProjectCatalog,
} from '../core/projects.js';
import { repositoryVersions } from '../core/learning/store.js';
import { createProjectRequestHandler } from './projects.js';
import { ExtensionStore } from './extensions.js';
import { ResourceSettings } from './resources.js';
import { WebSessionStore } from './sessions/store.js';
import { codebergHome } from '../core/paths.js';
import { defaultProviders } from '../providers/index.js';
import { createRequestHandler, type ChatResponder } from './server.js';
import { formatWebTitle } from './title.js';
import { ModelSettingsStore } from './model-selection/settings.js';
import {
  createLearningGenerator,
  createWebModelPool,
  ReloadableAgentPool,
} from './model-selection/runtime.js';

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
  process.env.CODEBERG_LOG_DIR ??= join(codebergHome(), 'logs');
  const entry = await webEntry();

  const providers = defaultProviders();
  const modelSettings = new ModelSettingsStore({
    defaultChat: { key: entry.modelSpec, effort: reasoningFromEnv() ?? 'provider-default' },
    defaultLearning: {
      key: entry.subagentModelSpec ?? entry.modelSpec,
      effort: 'provider-default',
    },
    availableProvider: (provider) => Boolean(providers.get(provider)),
  });

  const selected = await modelSettings.current();
  const catalog = await loadProjectCatalog(entry.daemonUrl);
  const extensions = new ExtensionStore(codebergHome());
  const owned: OwnedRuntime[] = [];
  const chosen = selected.models.find((model) => model.key === selected.chat.key)!;
  const server = createProjectServer({
    catalog,
    entry,
    extensions,
    modelSettings,
    providers,
    owned,
    title: formatWebTitle(chosen.model, selected.chat.effort),
  });

  writeModuleLog('agent', 'started');

  const port = Number(process.env.CODEBERG_WEB_PORT ?? process.env.PORT ?? DEFAULT_PORT);
  server.listen(port, HOST, () => {
    console.error(`codeberg-web listening on http://${HOST}:${port}`);
  });

  installShutdown(server, owned);
}

interface OwnedRuntime {
  learning?: LearningService;
  resources: ResourceSettings;
  pool: ReloadableAgentPool;
}

interface ProjectRuntimeOptions {
  entry: NonNullable<ReturnType<typeof parseEntryArgs>>;
  catalog: ProjectCatalog;
  extensions: ExtensionStore;
  modelSettings: ModelSettingsStore;
  providers: ReturnType<typeof defaultProviders>;
  owned: OwnedRuntime[];
  title: string;
}

async function webEntry() {
  const entry = parseEntryArgs(process.argv);
  if (!entry) {
    const catalog = join(codebergHome(), 'models.yml');
    const exists = await stat(catalog)
      .then((value) => value.isFile())
      .catch(() => false);
    if (!exists) {
      console.error(entryUsage('codeberg-web'));
      process.exit(1);
    }

    return {
      modelSpec: '',
      question: '',
      daemonUrl: process.env.CODEBERG_DAEMON_URL ?? DEFAULT_DAEMON_URL,
    };
  }

  return entry;
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
      daemonUrl: entry.daemonUrl,
      extensions: (req, res, project) =>
        extensions.route(req, res, projectEnvironment(process.env, project, catalog)),
      build: (project) => buildProjectHandler(project, options),
    }),
  );
}

async function buildProjectHandler(project: Project, options: ProjectRuntimeOptions) {
  const { entry, catalog, modelSettings, providers, extensions, owned, title } = options;

  const env = projectEnvironment(process.env, project, catalog);
  const home = projectDataHome(codebergHome(), project.id);
  const learning = learningEnabledFromEnv()
    ? new LearningService({
        root: join(home, 'learning'),
        repositories: () => repositoryVersions(project.roots.map((root) => root.root)),
        generator: createLearningGenerator(modelSettings, (spec) => providers.resolve(spec)),
      })
    : undefined;

  const sessions = new WebSessionStore(join(home, 'web-sessions'));
  const daemonUrl = `${entry.daemonUrl.replace(/\/$/, '')}/projects/${project.id}`;
  const resources = new ResourceSettings({
    home,
    env,
    sessions,
    learning,
    daemonUrl: entry.daemonUrl,
  });

  const pool = new ReloadableAgentPool(() => createWebModelPool(daemonUrl, learning ?? false, env));
  const runtime = { learning, resources, pool };
  owned.push(runtime);
  resources.start();
  // Recover durable work independently of chat; failed initialization can retry.
  try {
    if (learning) await learning.initialize();
  } catch (error) {
    learning?.stop();
    resources.stop();
    owned.splice(owned.indexOf(runtime), 1);
    throw error;
  }

  return createRequestHandler({
    daemonUrl,
    sessionStore: sessions,
    resources,
    learning,
    modelSettings,
    respond: projectResponder(pool, extensions, learning),
    title,
    staticRoot: process.env.CODEBERG_WEB_ROOT ?? defaultStaticRoot(),
  });
}

function projectResponder(
  pool: ReloadableAgentPool,
  extensions: ExtensionStore,
  learning?: LearningService,
): ChatResponder {
  return async (res, messages, selection) => {
    if (!selection) throw new Error('Choose a chat model first.');

    const lease = await pool.acquire(
      selection,
      extensions.revision + (learning?.settingsRevision ?? 0),
    );

    let routed = false;
    let finished = res.writableEnded || res.destroyed;
    const release = () => {
      if (routed && finished)
        void lease
          .release()
          .catch((error: unknown) =>
            writeModuleLog('agent', 'extension_cleanup_failed', { error: String(error) }),
          );
    };

    const complete = () => {
      finished = true;
      release();
    };

    res.once('finish', complete);
    res.once('close', complete);
    try {
      await pipeAgentUIStreamToResponse({
        response: res,
        agent: lease.agent,
        uiMessages: messages,
      });
    } finally {
      routed = true;
      finished ||= res.writableEnded || res.destroyed;
      release();
    }
  };
}

function stopRuntimes(owned: OwnedRuntime[]): void {
  for (const runtime of owned) {
    runtime.learning?.stop();
    runtime.resources.stop();
  }
}

function installShutdown(server: Server, owned: OwnedRuntime[]): void {
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      process.exit(signal === 'SIGINT' ? 130 : 143);
    }

    shuttingDown = true;
    // The durable queue recovers interrupted work on the next launch.
    stopRuntimes(owned);
    writeModuleLog('agent', 'stopping', { signal });
    writeModuleLog('learning-agent', 'stopping', { signal });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.all(owned.map((runtime) => runtime.pool.close()));
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('beforeExit', () => {
    stopRuntimes(owned);
    for (const runtime of owned) void runtime.pool.close();
  });
}

main().catch((err: unknown) => {
  writeModuleLog('agent', 'startup_failed', { error: String(err) });
  console.error(err);
  process.exit(1);
});
