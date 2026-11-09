import type { ChatGenerator } from '../runs/types.js';
import type { SearchRuns } from '../runs/manager.js';
import type { CanvasStore } from '../../core/canvas/store.js';
import type { PromptCommand } from '../../core/hooks/types.js';
import type { LearningService } from '../../core/learning/service.js';
import { type ModelSettingsStore } from '../model-selection/settings.js';
import { ResourceSettings } from '../resources.js';
import { WebSessionStore } from '../sessions/store.js';
import type { UsageStore } from '../usage/store.js';

/** The endpoint the browser chat client posts its message history to. */
export const CHAT_PATH = '/api/chat';

/** Lightweight metadata (active model/daemon) for the UI title bar. */
export const META_PATH = '/api/meta';

/** Slash-command catalog (e.g. `/enhance`) for the composer autocomplete. */
export const COMMANDS_PATH = '/api/commands';

/** Saved-chat CRUD: list (`GET`), and load/save/delete one at `/api/sessions/<id>`. */
export const SESSIONS_PATH = '/api/sessions';

export const CHAT_SEARCH_PATH = '/api/chat-search';

export const MODELS_PATH = '/api/models';

export interface WebServerOptions {
  /** Server-owned search execution; disconnected subscribers do not cancel it. */
  runs?: SearchRuns;
  /** Builds the default `runs` when none is supplied. */
  generate?: ChatGenerator;
  /** Shared durable model accounting across every project. */
  usage?: UsageStore;
  /** Shown in the page title bar; also returned from `/api/meta`. */
  title: string;
  canvas?: CanvasStore;
  /**
   * Directory of the built React SPA (`web-ui/dist`). When present, it is
   * served at `/`; when absent or unbuilt, the dependency-free fallback page is
   * served instead, so `codeberg-web` works with no frontend build step.
   */
  staticRoot?: string;
  /**
   * Backs the default `runs` and the `/api/sessions` routes. Defaults to a
   * `WebSessionStore` under `<CODEBERG_HOME>/web-sessions`; inject one (e.g. a
   * temp dir) in tests. Ignored when `runs` is supplied.
   */
  sessionStore?: WebSessionStore;
  /** Durable interaction/feedback/knowledge subsystem. */
  learning?: LearningService;
  /** Persistent catalog and UI choices. Omitted for servers without model selection. */
  modelSettings?: ModelSettingsStore;
  /**
   * Slash commands served at `/api/commands` for the composer autocomplete.
   * Defaults to the built-in hook catalog, so a newly registered prompt hook
   * shows up in the UI without any wiring here.
   */
  commands?: PromptCommand[];
  /** Local monitoring/cleanup service. The server owns its sampling lifecycle. */
  resources?: ResourceSettings;
}

/** The services every project request handler routes to. */
export type ProjectServices = WebServerOptions & {
  runs: SearchRuns;
  resources: ResourceSettings;
  usage: UsageStore;
};
