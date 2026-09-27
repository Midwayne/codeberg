import type { UIMessage } from 'ai';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';

import type { Generator } from '../types.js';
import { DurableJobQueue } from './queue.js';
import { DatasetStore } from './datasets.js';
import { memorySourceState, sourceKey, type SourceObservation } from './memory-source.js';
import { interactionRevisions } from './revision.js';
import { KnowledgeSourceWatcher } from './source-watcher.js';
import { LearningStore, defaultLearningRoot, stableId } from './store.js';
import type { FeedbackLabel, FeedbackRating, FeedbackRecord, RepositoryVersion } from './types.js';
import { KnowledgeWorker } from './worker.js';

export class LearningService {
  readonly store: LearningStore;
  readonly queue: DurableJobQueue;
  readonly worker?: KnowledgeWorker;
  readonly datasets: DatasetStore;
  readonly knowledgeEnabled: boolean;
  private starting?: Promise<void>;
  private refreshTimer?: NodeJS.Timeout;
  private checking?: Promise<void>;
  private stopping = false;
  private pendingSources = new Set<string>();
  private fullScanRequested = false;
  private readonly sourceWatcher: KnowledgeSourceWatcher;

  constructor(options: { root?: string; generator?: Generator; repositories?: () => Promise<RepositoryVersion[]> } = {}) {
    const root = options.root ?? defaultLearningRoot();
    this.store = new LearningStore(root, options.repositories);
    this.queue = new DurableJobQueue(root);
    this.knowledgeEnabled = Boolean(options.generator);
    this.datasets = new DatasetStore(this.store);
    this.sourceWatcher = new KnowledgeSourceWatcher(this.store, (sources) => {
      void this.refreshKnowledge(sources).catch((error: unknown) => console.error('knowledge source refresh failed:', error));
    });
    this.worker = new KnowledgeWorker(this.store, this.queue, options.generator, () => {
      void this.sourceWatcher.sync().catch((error: unknown) => console.error('knowledge source watcher update failed:', error));
    });
  }

  initialize(): Promise<void> {
    this.starting ??= this.start().catch((error: unknown) => {
      this.starting = undefined;
      throw error;
    });
    return this.starting;
  }

  private async start(): Promise<void> {
    await this.ensureLayout();
    await this.queue.reconcileStates();
    await this.reconcileJobs();
    await this.refreshKnowledge();
    await this.worker?.initialize();
    await this.sourceWatcher.sync();
    if (this.knowledgeEnabled) {
      this.refreshTimer = setInterval(() => {
        void this.refreshKnowledge().catch((error: unknown) => console.error('knowledge refresh scan failed:', error));
      }, 2 * 60_000);
      this.refreshTimer.unref();
    }
  }

  async recordSession(
    conversationId: string,
    messages: UIMessage[],
    parentConversationId?: string,
  ): Promise<void> {
    const attempts = await this.store.recordSession(conversationId, messages, parentConversationId);
    const newIds = new Set(attempts.map((attempt) => attempt.attempt_id));
    for (const id of new Set(attempts.map((attempt) => attempt.interaction_id))) {
      const interaction = await this.store.interaction(id);
      const newAnswers = interaction.attempts.filter((attempt) => newIds.has(attempt.attempt_id) && attempt.answer.trim());
      if (!newAnswers.length) continue;
      if (interaction.feedback.length || newAnswers.some((attempt) => attempt.tools_invoked.length)) {
        await this.queue.enqueueDataset(id, { requeueCompleted: true });
      }
      if (interaction.feedback.some((feedback) => feedback.label === 'solved')) {
        await this.queue.enqueueKnowledge(id, { requeueCompleted: true });
      }
      this.worker?.wake();
    }
  }

  async feedback(input: {
    conversationId: string;
    messageId: string;
    rating: FeedbackRating;
    label: FeedbackLabel;
    reason?: string;
  }): Promise<{ feedback: FeedbackRecord; jobId?: string; jobStatus?: string }> {
    const attempt = await this.store.attemptForMessage(input.conversationId, input.messageId);
    if (!attempt) throw new Error('attempt not found; wait for the conversation to finish saving');
    const feedback = await this.store.recordFeedback({
      attemptId: attempt.attempt_id,
      rating: input.rating,
      label: input.label,
      reason: input.reason,
    });
    try {
      await this.queue.enqueueDataset(attempt.interaction_id, { requeueCompleted: true });
      this.worker?.wake();
    } catch (error) {
      console.error('dataset job enqueue failed; feedback is saved:', error);
    }
    // A change to an older attempt can invalidate knowledge learned from a newer
    // solved attempt (or vice versa). Revisit the entire logical interaction.
    const interaction = await this.store.interaction(attempt.interaction_id);
    if (!interaction.feedback.some((entry) => entry.label === 'solved')) return { feedback };
    try {
      const job = await this.queue.enqueueKnowledge(attempt.interaction_id, {
        requeueCompleted: true,
      });
      this.worker?.wake();
      return { feedback, jobId: job.job_id, jobStatus: job.status };
    } catch (error) {
      // The feedback event is already durable. Reconcile this handoff on startup.
      console.error('knowledge job enqueue failed; feedback is saved:', error);
      return { feedback };
    }
  }

  isWorking(): boolean {
    return this.worker?.isRunning() ?? false;
  }

  async activeJobs(): Promise<number> {
    const now = Date.now();
    const [pending, processing] = await Promise.all([this.queue.list('pending'), this.queue.list('processing')]);
    return [...pending.filter((job) => !job.next_attempt_at || Date.parse(job.next_attempt_at) <= now), ...processing]
      .filter((job) => this.knowledgeEnabled || job.type === 'extract_dataset').length;
  }

  async waitForCurrent(): Promise<void> {
    await this.worker?.waitForCurrent();
    await this.sourceWatcher.sync();
  }

  stop(): void {
    this.stopping = true;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.sourceWatcher.stop();
    this.worker?.stop();
  }

  /** Recheck memory against live repos; durable knowledge jobs perform the refresh. */
  refreshKnowledge(sources?: Iterable<string>): Promise<void> {
    if (!this.knowledgeEnabled || this.stopping) return Promise.resolve();
    if (sources) for (const source of sources) this.pendingSources.add(source);
    else this.fullScanRequested = true;
    this.checking ??= this.drainScans().finally(() => { this.checking = undefined; });
    return this.checking;
  }

  private async drainScans(): Promise<void> {
    while (this.fullScanRequested || this.pendingSources.size) {
      const sources = this.fullScanRequested ? undefined : new Set(this.pendingSources);
      this.fullScanRequested = false;
      this.pendingSources.clear();
      await this.scanKnowledge(sources);
    }
  }

  private async scanKnowledge(sources?: Set<string>): Promise<void> {
    const [artifacts, repositories] = await Promise.all([this.store.knowledgeArtifacts(), this.store.repositories()]);
    const sourceCache = new Map<string, Promise<SourceObservation>>();
    for (const artifact of artifacts) {
      if (this.stopping) return;
      if (sources && !artifact.source_refs?.some((ref) => sources.has(sourceKey(ref)))) continue;
      const state = await memorySourceState(artifact, repositories, sourceCache);
      if (state.fresh && artifact.status !== 'needs_verification') continue;
      for (const id of artifact.source_interactions) {
        const job = await this.queue.get(stableId('job', 'extract_knowledge', id));
        if (job?.source_code_revision === state.revision && ['completed', 'failed'].includes(job.status)) continue;
        await this.queue.enqueueKnowledge(id, { requeueCompleted: true });
      }
    }
    this.worker?.wake();
    await this.sourceWatcher.sync();
  }

  /** Replay the feedback-to-job handoff if the process stopped between the two durable writes. */
  private async reconcileJobs(): Promise<void> {
    const events = await this.store.events();
    const interactionForAttempt = new Map(events.flatMap((event) =>
      event.type === 'attempt_recorded' ? [[event.attempt.attempt_id, event.attempt.interaction_id] as const] : []));
    const revisions = interactionRevisions(events);
    const everSolved = new Set<string>();
    for (const event of events) {
      if (event.type !== 'feedback_recorded' || event.feedback.label !== 'solved') continue;
      const id = interactionForAttempt.get(event.feedback.attempt_id);
      if (id) everSolved.add(id);
    }

    const latestKnowledge = new Map<string, string>();
    const latestDataset = new Map<string, string>();
    for (const event of events) {
      const id = event.type === 'attempt_recorded'
        ? event.attempt.interaction_id
        : interactionForAttempt.get(event.feedback.attempt_id);
      if (!id) continue;

      if (everSolved.has(id)) latestKnowledge.set(id, event.timestamp);
      if (event.type === 'feedback_recorded' || (event.attempt.answer.trim() && event.attempt.tools_invoked.length)) {
        latestDataset.set(id, event.timestamp);
      }
    }

    for (const [id, timestamp] of latestKnowledge) {
      await this.reconcileJob('knowledge', id, timestamp, revisions.get(id));
    }
    for (const [id, timestamp] of latestDataset) {
      await this.reconcileJob('dataset', id, timestamp, revisions.get(id));
    }
  }

  private async reconcileJob(
    kind: 'knowledge' | 'dataset',
    interactionId: string,
    lastEvent: string,
    revision?: string,
  ): Promise<void> {
    const enqueue = kind === 'knowledge'
      ? this.queue.enqueueKnowledge.bind(this.queue)
      : this.queue.enqueueDataset.bind(this.queue);
    const jobId = (await enqueue(interactionId)).job_id;
    const job = await this.queue.get(jobId);
    if (job && ['completed', 'failed'].includes(job.status) &&
      (job.source_revision !== revision || job.updated_at < lastEvent)) {
      await enqueue(interactionId, { requeueCompleted: true });
    }
  }

  private async ensureLayout(): Promise<void> {
    await Promise.all([
      mkdir(join(this.store.root, 'events'), { recursive: true }),
      ...['services', 'flows', 'concepts', 'debugging'].map((name) =>
        mkdir(join(this.store.root, 'knowledge', name), { recursive: true }),
      ),
      ...['pending', 'processing', 'completed', 'failed'].map((name) =>
        mkdir(join(this.store.root, 'jobs', name), { recursive: true }),
      ),
      mkdir(join(this.store.root, 'datasets', 'embedding'), { recursive: true }),
      ...['candidates', 'eval', 'training'].map((name) => mkdir(join(this.store.root, 'datasets', name), { recursive: true })),
    ]);
    try {
      const readme = await open(join(this.store.root, 'README.md'), 'wx', 0o600);
      try {
        await readme.writeFile(
          '# Codeberg learning data\n\n' +
            'events/ is the append-only source of truth. Knowledge, jobs, and datasets are derived or retryable.\n',
          'utf8',
        );
        await readme.sync();
      } finally {
        await readme.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}
