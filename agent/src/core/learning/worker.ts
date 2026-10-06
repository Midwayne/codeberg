import type { Generator } from '../types.js';
import { DatasetStore } from './datasets.js';
import { DEFAULT_LEARNING_SETTINGS, type LearningSettings } from './preferences.js';
import { DurableJobQueue } from './queue.js';
import { LearningStore } from './store.js';
import {
  initialize,
  isProcessing,
  isRunning,
  pause,
  resume,
  runUntilIdle,
  stop,
  waitForCurrent,
  wake,
} from './worker/lifecycle.js';
import { KnowledgeWorkerState } from './worker/state.js';

export class KnowledgeWorker {
  private readonly state: KnowledgeWorkerState;

  constructor(
    store: LearningStore,
    queue: DurableJobQueue,
    generator?: Generator,
    onKnowledgeChanged?: () => void,
    settings: () => LearningSettings = () => DEFAULT_LEARNING_SETTINGS,
    datasets = new DatasetStore(store),
  ) {
    this.state = new KnowledgeWorkerState(
      store,
      queue,
      generator,
      onKnowledgeChanged,
      settings,
      datasets,
    );
  }

  initialize(): Promise<void> {
    return initialize(this.state);
  }

  wake(): void {
    return wake(this.state);
  }

  /** Stop taking work; a processing lease is recovered after restart if interrupted. */
  stop(): void {
    return stop(this.state);
  }

  isRunning(): boolean {
    return isRunning(this.state);
  }

  /** A claimed job is executing, rather than waiting, polling, or retrying later. */
  isProcessing(): boolean {
    return isProcessing(this.state);
  }

  pause(): void {
    return pause(this.state);
  }

  resume(): void {
    return resume(this.state);
  }

  waitForCurrent(): Promise<void> {
    return waitForCurrent(this.state);
  }

  runUntilIdle(): Promise<void> {
    return runUntilIdle(this.state);
  }
}

export { parseExtractionResponse } from './knowledge-response.js';

export { KNOWLEDGE_EXTRACTION_VERSION } from './worker/constants.js';
