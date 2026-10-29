import { canvasFromEnv } from '../../core/canvas/config.js';
import { SearchRuns } from '../runs/manager.js';
import type { ChatGenerator } from '../runs/types.js';
import type { CanvasStore } from '../../core/canvas/store.js';
import { createAgentUIStream } from 'ai';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { learningEnabledFromEnv } from '../../core/config.js';
import { LearningService } from '../../core/learning/service.js';
import { repositoryVersions } from '../../core/learning/store.js';
import { codebergHome } from '../../core/paths.js';
import { projectDataHome, projectEnvironment, type Project } from '../../core/projects.js';
import { ExtensionStore } from '../extensions.js';
import {
  createLearningGenerator,
  createWebModelPool,
  ReloadableAgentPool,
} from '../model-selection/runtime.js';
import { ResourceSettings } from '../resources.js';
import { createRequestHandler } from '../server.js';
import { WebSessionStore } from '../sessions/store.js';
import type { OwnedRuntime, ProjectRuntimeOptions } from './types.js';
import { sharedUsageStore } from '../usage/shared.js';
import { projectUsageTracker } from '../usage/project.js';
import { decisionUsageTracker } from '../usage/decisions.js';
import type { ToolSettingsStore } from '../tools/settings.js';
import { projectEvaluationRuntime } from './evaluations.js';

// The built React SPA lives at `web-ui/dist`, one level up from this bundle
// (`dist/web.js`). Override with CODEBERG_WEB_ROOT; if it is unbuilt, the server
// falls back to the embedded dependency-free page.
export function defaultStaticRoot(): string {
  return fileURLToPath(new URL('../web-ui/dist', import.meta.url));
}

export async function buildProjectHandler(project: Project, options: ProjectRuntimeOptions) {
  const { entry, catalog, modelSettings, providers, extensions, owned, title } = options;

  const env = projectEnvironment(process.env, project, catalog);
  const canvas = canvasFromEnv(env);
  const home = projectDataHome(codebergHome(), project.id);
  const usage = sharedUsageStore();
  const track = projectUsageTracker(usage, modelSettings, project);
  const daemonUrl = `${entry.daemonUrl.replace(/\/$/, '')}/projects/${project.id}`;
  const learning = learningEnabledFromEnv()
    ? new LearningService({
        root: join(home, 'learning'),
        repositories: () => repositoryVersions(project.roots.map((root) => root.root)),
        evaluation: projectEvaluationRuntime(daemonUrl, modelSettings, (spec) => providers.resolve(spec), track),
        generator: createLearningGenerator(modelSettings, (spec) => providers.resolve(spec),
          (model, key, spec) => track(model, key, spec, 'learning')),
      })
    : undefined;

  const sessions = new WebSessionStore(join(home, 'web-sessions'));
  const resources = new ResourceSettings({
    home,
    env,
    sessions,
    learning,
    daemonUrl: entry.daemonUrl,
  });

  const pool = new ReloadableAgentPool((webEnv) => createWebModelPool(daemonUrl, learning ?? false, { ...env, ...webEnv },
    (model, selection) => track(model, selection.key, selection.model, 'chat'), decisionUsageTracker(usage, project)));
  const runs = new SearchRuns(sessions, projectGenerator(pool, extensions, learning, canvas, options.tools), { learning });
  const runtime = { projectId: project.id, learning, resources, pool, canvas, runs };
  owned.push(runtime);
  resources.start();
  await initializeRuntime(runtime, owned);

  return createRequestHandler({
    daemonUrl,
    canvas,
    sessionStore: sessions,
    resources,
    learning,
    modelSettings,
    usage,
    runs,
    title,
    staticRoot: process.env.CODEBERG_WEB_ROOT ?? defaultStaticRoot(),
  });
}

async function initializeRuntime(runtime: OwnedRuntime, owned: OwnedRuntime[]) {
  // Recover durable work independently of chat; failed initialization can retry.
  try {
    await runtime.learning?.initialize();
  } catch (error) {
    runtime.learning?.stop();
    runtime.resources.stop();
    owned.splice(owned.indexOf(runtime), 1);

    throw error;
  }
}

export function projectGenerator(
  pool: ReloadableAgentPool,
  extensions: ExtensionStore,
  learning?: LearningService,
  canvas?: CanvasStore,
  tools?: ToolSettingsStore,
): ChatGenerator {
  return async ({ messages, selection, signal }) => {
    if (!selection) throw new Error('Choose a chat model first.');
    const webEnv = await tools?.environment();

    const lease = await pool.acquire(
      selection,
      JSON.stringify([extensions.revision, learning?.settingsRevision ?? 0, await canvas?.available(), webEnv]),
      webEnv,
    );

    try {
      const stream = await createAgentUIStream({ agent: lease.agent, uiMessages: messages, abortSignal: signal });

      return { stream, close: () => lease.release() };
    } catch (error) {
      await lease.release();
      throw error;
    }
  };
}
