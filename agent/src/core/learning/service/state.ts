import { writeModuleLog } from '../../module-log.js';
import type { Generator } from '../../types.js';
import { DatasetStore } from '../datasets.js';
import { DreamingReports } from '../dreaming/reports.js';
import { DEFAULT_LEARNING_SETTINGS, type LearningSettings } from '../preferences.js';
import { DurableJobQueue } from '../queue.js';
import { LearningSettingsStore } from '../settings.js';
import { KnowledgeSourceWatcher } from '../source-watcher.js';
import { LearningStore, defaultLearningRoot } from '../store.js';
import type { RepositoryVersion } from '../types.js';
import { KnowledgeWorker } from '../worker.js';
import { refreshKnowledge } from './refresh.js';
import { syncWatcher } from './settings.js';

export class LearningServiceState {
  readonly store: LearningStore;

  readonly dreamingReports: DreamingReports;

  readonly queue: DurableJobQueue;

  readonly worker?: KnowledgeWorker;

  readonly datasets: DatasetStore;

  readonly hasGenerator: boolean;

  readonly settingsStore: LearningSettingsStore;

  preferences = structuredClone(DEFAULT_LEARNING_SETTINGS);

  settingsRevision = 0;

  get settings(): LearningSettings {
    return structuredClone(this.preferences);
  }

  get knowledgeCaptureEnabled(): boolean {
    return (
      this.preferences.enabled &&
      this.preferences.knowledge &&
      this.preferences.knowledgeCapture &&
      Object.values(this.preferences.categories).some(Boolean)
    );
  }

  get knowledgeEnabled(): boolean {
    return (
      this.preferences.enabled &&
      this.preferences.knowledge &&
      this.hasGenerator &&
      Object.values(this.preferences.categories).some(Boolean)
    );
  }

  get datasetEnabled(): boolean {
    return (
      this.preferences.enabled &&
      this.preferences.datasets &&
      Object.values(this.preferences.kinds).some(Boolean)
    );
  }

  starting?: Promise<void>;

  initialized = false;

  refreshTimer?: NodeJS.Timeout;

  checking?: Promise<void>;

  background?: Promise<void>;

  stopping = false;

  maintenance = false;

  pendingSources = new Set<string>();

  fullScanRequested = false;

  readonly sourceWatcher: KnowledgeSourceWatcher;

  constructor(
    options: {
      root?: string;
      generator?: Generator;
      repositories?: () => Promise<RepositoryVersion[]>;
    } = {},
  ) {
    const root = options.root ?? defaultLearningRoot();
    this.store = new LearningStore(root, options.repositories);
    this.dreamingReports = new DreamingReports(root);
    this.queue = new DurableJobQueue(root);
    this.hasGenerator = Boolean(options.generator);
    this.settingsStore = new LearningSettingsStore(root);
    this.datasets = new DatasetStore(this.store);
    this.sourceWatcher = new KnowledgeSourceWatcher(this.store, (sources) => {
      void refreshKnowledge(this, sources).catch((error: unknown) => {
        console.error('knowledge source refresh failed:', error);
        writeModuleLog('learning-agent', 'source_refresh_failed', { error: String(error) });
      });
    });
    this.worker = new KnowledgeWorker(
      this.store,
      this.queue,
      options.generator,
      () => {
        this.settingsRevision++;
        void syncWatcher(this).catch((error: unknown) => {
          console.error('knowledge source watcher update failed:', error);
          writeModuleLog('learning-agent', 'watcher_update_failed', { error: String(error) });
        });
      },
      () => this.preferences,
      this.datasets,
    );
  }
}
