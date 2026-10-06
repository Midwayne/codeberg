import type { UIMessage } from 'ai';
import type { Generator } from '../types.js';
import { DatasetStore } from './datasets.js';
import { DreamingReports } from './dreaming/reports.js';
import type { DreamingDecision } from './dreaming/types.js';
import type { LearningSettings } from './preferences.js';
import { DurableJobQueue } from './queue.js';
import {
  activeJobs,
  isUpdating,
  isWorking,
  waitForCurrent,
  withMaintenance,
} from './service/activity.js';
import { feedback, recordSession } from './service/capture.js';
import { decideDreaming, knowledgeIndex, requestDreaming } from './service/dreaming.js';
import { initialize, stop } from './service/lifecycle.js';
import { refreshKnowledge } from './service/refresh.js';
import { getSettings, updateSettings } from './service/settings.js';
import { LearningServiceState } from './service/state.js';
import { LearningStore } from './store.js';
import type { FeedbackLabel, FeedbackRating, FeedbackRecord, RepositoryVersion } from './types.js';
import { KnowledgeWorker } from './worker.js';

export class LearningService {
  private readonly state: LearningServiceState;

  constructor(
    options: {
      root?: string;
      generator?: Generator;
      repositories?: () => Promise<RepositoryVersion[]>;
    } = {},
  ) {
    this.state = new LearningServiceState(options);
  }

  get store(): LearningStore {
    return this.state.store;
  }

  get dreamingReports(): DreamingReports {
    return this.state.dreamingReports;
  }

  get queue(): DurableJobQueue {
    return this.state.queue;
  }

  get worker(): KnowledgeWorker | undefined {
    return this.state.worker;
  }

  get datasets(): DatasetStore {
    return this.state.datasets;
  }

  get settingsRevision() {
    return this.state.settingsRevision;
  }

  set settingsRevision(value: typeof this.state.settingsRevision) {
    this.state.settingsRevision = value;
  }

  get settings(): LearningSettings {
    return this.state.settings;
  }

  get knowledgeEnabled(): boolean {
    return this.state.knowledgeEnabled;
  }

  get datasetEnabled(): boolean {
    return this.state.datasetEnabled;
  }

  getSettings(): Promise<LearningSettings> {
    return getSettings(this.state);
  }

  updateSettings(patch: unknown): Promise<LearningSettings> {
    return updateSettings(this.state, patch);
  }

  initialize(): Promise<void> {
    return initialize(this.state);
  }

  /** Manual requests work independently of extraction and daily scheduling. */
  requestDreaming() {
    return requestDreaming(this.state);
  }

  decideDreaming(id: string, action: DreamingDecision) {
    return decideDreaming(this.state, id, action);
  }

  knowledgeIndex(): Promise<string> {
    return knowledgeIndex(this.state);
  }

  recordSession(
    conversationId: string,
    messages: UIMessage[],
    parentConversationId?: string,
  ): Promise<void> {
    return recordSession(this.state, conversationId, messages, parentConversationId);
  }

  feedback(input: {
    conversationId: string;
    messageId: string;
    rating: FeedbackRating;
    label: FeedbackLabel;
    reason?: string;
  }): Promise<{ feedback: FeedbackRecord; jobId?: string; jobStatus?: string }> {
    return feedback(this.state, input);
  }

  isWorking(): boolean {
    return isWorking(this.state);
  }

  /** Cheap, current execution state for the UI activity indicator. */
  isUpdating(): boolean {
    return isUpdating(this.state);
  }

  activeJobs(): Promise<number> {
    return activeJobs(this.state);
  }

  waitForCurrent(): Promise<void> {
    return waitForCurrent(this.state);
  }

  /** Quiesce derived-data writers while resource cleanup runs. */
  withMaintenance<T>(action: () => Promise<T>): Promise<T> {
    return withMaintenance(this.state, action);
  }

  stop(): void {
    return stop(this.state);
  }

  /** Recheck memory against live repos; durable knowledge jobs perform the refresh. */
  refreshKnowledge(sources?: Iterable<string>): Promise<void> {
    return refreshKnowledge(this.state, sources);
  }
}
