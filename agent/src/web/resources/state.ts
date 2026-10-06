import { resolve } from 'node:path';
import type { LearningService } from '../../core/learning/service.js';
import { defaultLearningRoot } from '../../core/learning/store.js';
import { codebergHome } from '../../core/paths.js';
import { ResourceMonitorClient, type ResourceReader } from '../resource-monitor.js';
import { type WebSessionStore } from '../sessions/store.js';

export class ResourceSettingsState {
  readonly home: string;

  readonly learningRoot: string;

  readonly monitor: ResourceReader;

  readonly env: NodeJS.ProcessEnv;

  busy = false;

  constructor(
    readonly options: {
      home?: string;
      sessions: WebSessionStore;
      learning?: LearningService;
      daemonUrl?: string;
      env?: NodeJS.ProcessEnv;
      monitor?: ResourceReader;
    },
  ) {
    this.env = options.env ?? process.env;
    this.home = resolve(options.home ?? codebergHome(this.env));
    this.learningRoot = resolve(
      options.learning?.store.root ??
        defaultLearningRoot({ ...this.env, CODEBERG_HOME: this.home }),
    );
    this.monitor =
      options.monitor ??
      new ResourceMonitorClient({
        home: this.home,
        sessionsDir: options.sessions.dir,
        learningRoot: this.learningRoot,
        env: this.env,
        daemonUrl: options.daemonUrl ?? this.env.CODEBERG_DAEMON_URL,
      });
  }
}
