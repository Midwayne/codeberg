import type { IncomingMessage, ServerResponse } from 'node:http';
import { route } from './extensions/routes.js';
import { ExtensionStoreState } from './extensions/state.js';
import { add } from './extensions/writing.js';

/** Serialize the shared file separately from each project's file so two tabs
 * adding global MCP servers cannot silently overwrite each other's changes. */
export class ExtensionStore {
  private readonly state: ExtensionStoreState;

  constructor(home: string) {
    this.state = new ExtensionStoreState(home);
  }

  get revision() {
    return this.state.revision;
  }

  set revision(value: typeof this.state.revision) {
    this.state.revision = value;
  }

  add(projectHome: string, input: unknown, env: NodeJS.ProcessEnv = process.env): Promise<void> {
    return add(this.state, projectHome, input, env);
  }

  route(req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv) {
    return route(this.state, req, res, env);
  }
}

export type { SkillFilePreview } from './extensions/preview.js';

export { previewSkillFiles } from './extensions/preview.js';
