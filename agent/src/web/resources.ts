import type { LearningService } from '../core/learning/service.js';
import type { ResourceReader } from './resource-monitor.js';
import { cleanup, preview } from './resources/cleanup.js';
import { start, stop, usage } from './resources/monitor.js';
import { ResourceSettingsState } from './resources/state.js';
import { type WebSessionStore } from './sessions/store.js';

/** Narrowly scoped cleanup and a cached metrics transport; collection is isolated. */
export class ResourceSettings {
  private readonly state: ResourceSettingsState;

  constructor(options: {
    home?: string;
    sessions: WebSessionStore;
    learning?: LearningService;
    daemonUrl?: string;
    env?: NodeJS.ProcessEnv;
    monitor?: ResourceReader;
  }) {
    this.state = new ResourceSettingsState(options);
  }

  get busy() {
    return this.state.busy;
  }

  set busy(value: typeof this.state.busy) {
    this.state.busy = value;
  }

  start(): void {
    return start(this.state);
  }

  stop(): void {
    return stop(this.state);
  }

  usage(after = 0) {
    return usage(this.state, after);
  }

  preview(olderThanDays: unknown) {
    return preview(this.state, olderThanDays);
  }

  cleanup(input: unknown) {
    return cleanup(this.state, input);
  }
}

export type { CleanupCategory, ResourceSample } from './resources/types.js';

export { CLEANUP_CATEGORIES, ResourceSettingsError } from './resources/types.js';
