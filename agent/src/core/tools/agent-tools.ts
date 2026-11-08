import { browserToolSource } from '../browser/tools.js';
import { searchBundleSource } from './search-bundle.js';
import { backgroundTools, BACKGROUND_INSTRUCTIONS } from '../background/tools.js';
import type { CanvasStore } from '../canvas/store.js';
import { CANVAS_INSTRUCTIONS, canvasToolSource } from '../canvas/tools.js';

import { DaemonClient } from '../client.js';
import { presentToolOutput } from '../context/spill.js';
import { ContextStore } from '../context/store.js';
import { contextToolSource } from '../context/tools.js';
import { extractEvidence } from '../evidence-extract.js';
import type { LearningSettings } from '../learning/preferences.js';
import type { LearningStore } from '../learning/store.js';
import { learningToolSource } from '../learning/tools.js';
import type { McpToolSource } from '../mcp/tools/state.js';
import type { SearchResult, ToolSpec } from '../types.js';
import type { WebConfig } from '../web/types.js';
import { composeTools, withToolMetadata, type ComposedTools, type ToolSource } from './source.js';
import { daemonToolSource } from './daemon.js';
import { searchCodeSource } from './search-code.js';
import { webToolSource } from './web.js';
import type { ModelInput } from '../model-types.js';
import { scheduleToolSource } from '../schedules/tools.js';

interface AgentToolOptions {
  env?: NodeJS.ProcessEnv;
  browserModel?: string;
  browserOwner?: string;
  browserInputs?: readonly ModelInput[];
  daemon: DaemonClient;
  canvas?: CanvasStore;
  context: ContextStore;
  learning?: LearningStore;
  learningSettings?: () => LearningSettings;
  web: WebConfig;
  mcp: () => McpToolSource;
  defaultSearchK: number;
  searchBundle?: boolean;
  onResults: (hits: SearchResult[]) => void;
  /** Schedules and background tools. The CLI ask path leaves this unset. */
  server?: boolean;
}

/** Owns tool ordering and evidence extraction for every agent turn. */
export async function createAgentTools(opts: AgentToolOptions): Promise<ComposedTools> {
  const specs = await opts.daemon.listTools();

  return composeTools(agentSources(opts, specs), { server: opts.server });
}

function agentSources(opts: AgentToolOptions, specs: readonly ToolSpec[]): ToolSource[] {
  const vectors = specs.some((spec) => spec.name === 'search');

  // search_code stays first so it cannot be shadowed by another source.
  return [
    ...(vectors ? [searchCodeSource({
      daemon: opts.daemon,
      defaultK: opts.defaultSearchK,
      onResults: opts.onResults,
    })] : []),
    ...(vectors && opts.searchBundle ? [searchBundleSource(opts)] : []),
    withToolMetadata(scheduleToolSource(), { batchable: false, serverOnly: true }),
    ...(opts.learning ? [learningToolSource(opts.learning, opts.learningSettings)] : []),
    contextToolSource(opts.context),
    ...(opts.canvas ? [withToolMetadata(canvasToolSource(opts.canvas), {
      batchable: false,
      instructions: CANVAS_INSTRUCTIONS,
    })] : []),
    browserToolSource({ ...opts.env, CODEBERG_WEB_USE: String(opts.web.enabled) }, opts.browserModel, undefined, opts.browserOwner, opts.browserInputs),
    daemonToolSource({
      daemon: opts.daemon,
      specs,
      onToolResult: (name, output) => {
        const hits = extractEvidence(name, output);
        if (hits.length > 0) {
          opts.onResults(hits);
        }
      },
    }),
    webToolSource(opts.web),
    opts.mcp(),
    backgroundSource(opts.context),
  ];
}

function backgroundSource(store: ContextStore): ToolSource {
  return {
    name: 'background',
    serverOnly: true,
    batchable: false,
    instructions: BACKGROUND_INSTRUCTIONS,
    tools: (earlier = {}) => backgroundTools(earlier, (name, args, output) => presentToolOutput(store, name, args, output)),
  };
}
