import type { CanvasStore } from '../../core/canvas/store.js';
import { type ToolLoopAgent } from 'ai';
import type { PromptCommand } from '../../core/hooks/index.js';
import type { LearningService } from '../../core/learning/service.js';
import type { ChatResponder, ResolvedModelSelection } from '../chat-routes.js';
import { type ModelSettingsStore } from '../model-selection/settings.js';
import { ResourceSettings } from '../resources.js';
import { WebSessionStore } from '../sessions/store.js';

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
  /** The ai-sdk agent driving each turn. */
  agent?: ToolLoopAgent;
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
   * How a chat turn is streamed back. Defaults to piping the agent's
   * UI-message stream. Override to layer on auth, persistence, or to test the
   * routing without a live model.
   */
  respond?: ChatResponder;
  /**
   * Backs the `/api/sessions` routes that persist browser chats so they can be
   * listed and resumed. Defaults to a `WebSessionStore` under `<CODEBERG_HOME>/
   * web-sessions`; inject one (e.g. a temp dir) in tests.
   */
  sessionStore?: WebSessionStore;
  /** Durable interaction/feedback/knowledge subsystem. */
  learning?: LearningService;
  /** Persistent catalog and UI choices. Omitted for servers without model selection. */
  modelSettings?: ModelSettingsStore;
  /** Resolve and cache a model-bound agent for this request's selection. */
  selectAgent?: (selection: ResolvedModelSelection) => Promise<ToolLoopAgent>;
  /**
   * Slash commands served at `/api/commands` for the composer autocomplete.
   * Defaults to the built-in hook catalog, so a newly registered prompt hook
   * shows up in the UI without any wiring here.
   */
  commands?: PromptCommand[];
  /** Local monitoring/cleanup service. The server owns its sampling lifecycle. */
  resources?: ResourceSettings;
  /** Resolve a separately launched local daemon for process resource accounting. */
  daemonUrl?: string;
}
