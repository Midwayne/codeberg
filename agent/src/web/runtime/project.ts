import { canvasFromEnv } from '../../core/canvas/config.js';
import type { CanvasStore } from '../../core/canvas/store.js';
import { pipeAgentUIStreamToResponse } from 'ai';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { learningEnabledFromEnv } from '../../core/config.js';
import { LearningService } from '../../core/learning/service.js';
import { repositoryVersions } from '../../core/learning/store.js';
import { writeModuleLog } from '../../core/module-log.js';
import { codebergHome } from '../../core/paths.js';
import { projectDataHome, projectEnvironment, type Project } from '../../core/projects.js';
import { ExtensionStore } from '../extensions.js';
import {
  createLearningGenerator,
  createWebModelPool,
  ReloadableAgentPool,
} from '../model-selection/runtime.js';
import { ResourceSettings } from '../resources.js';
import { createRequestHandler, type ChatResponder } from '../server.js';
import { WebSessionStore } from '../sessions/store.js';
import type { ProjectRuntimeOptions } from './types.js';

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
  const runtime = { learning, resources, pool, canvas };
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
    canvas,
    sessionStore: sessions,
    resources,
    learning,
    modelSettings,
    respond: projectResponder(pool, extensions, learning, canvas),
    title,
    staticRoot: process.env.CODEBERG_WEB_ROOT ?? defaultStaticRoot(),
  });
}

export function projectResponder(
  pool: ReloadableAgentPool,
  extensions: ExtensionStore,
  learning?: LearningService,
  canvas?: CanvasStore,
): ChatResponder {
  return async (res, messages, selection) => {
    if (!selection) throw new Error('Choose a chat model first.');

    const lease = await pool.acquire(
      selection,
      (extensions.revision + (learning?.settingsRevision ?? 0)) * 2 + Number((await canvas?.available()) ?? false),
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
