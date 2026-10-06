import { moduleLogDirectory } from '../../module-log.js';
import type { Generator } from '../../types.js';
import { DatasetStore } from '../datasets.js';
import { DEFAULT_LEARNING_SETTINGS, type LearningSettings } from '../preferences.js';
import { DurableJobQueue } from '../queue.js';
import { LearningStore } from '../store.js';

export class KnowledgeWorkerState {
  readonly logDir = moduleLogDirectory();

  running?: Promise<void>;

  retryTimer?: NodeJS.Timeout;

  stopping = false;

  paused = false;

  processing = false;

  constructor(
    readonly store: LearningStore,
    readonly queue: DurableJobQueue,
    readonly generator?: Generator,
    readonly onKnowledgeChanged?: () => void,
    readonly settings: () => LearningSettings = () => DEFAULT_LEARNING_SETTINGS,
    readonly datasets = new DatasetStore(store),
  ) {}
}
