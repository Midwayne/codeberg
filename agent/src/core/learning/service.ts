import type { UIMessage } from 'ai';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';

import type { Generator } from '../types.js';
import { DurableJobQueue } from './queue.js';
import { effectiveFeedback, LearningStore, defaultLearningRoot } from './store.js';
import type { FeedbackLabel, FeedbackRating, FeedbackRecord } from './types.js';
import { KnowledgeWorker } from './worker.js';

export class LearningService {
  readonly store: LearningStore;
  readonly queue: DurableJobQueue;
  readonly worker?: KnowledgeWorker;
  private starting?: Promise<void>;

  constructor(options: { root?: string; generator?: Generator } = {}) {
    const root = options.root ?? defaultLearningRoot();
    this.store = new LearningStore(root);
    this.queue = new DurableJobQueue(root);
    if (options.generator) this.worker = new KnowledgeWorker(this.store, this.queue, options.generator);
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
    await this.worker?.initialize();
  }

  async recordSession(
    conversationId: string,
    messages: UIMessage[],
    parentConversationId?: string,
  ): Promise<void> {
    await this.store.recordSession(conversationId, messages, parentConversationId);
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
    const previous = await this.store.currentFeedback(attempt.attempt_id);
    const feedback = await this.store.recordFeedback({
      attemptId: attempt.attempt_id,
      rating: input.rating,
      label: input.label,
      reason: input.reason,
    });
    if (feedback.label !== 'solved' && previous?.label !== 'solved') return { feedback };
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

  async waitForCurrent(): Promise<void> {
    await this.worker?.waitForCurrent();
  }

  stop(): void {
    this.worker?.stop();
  }

  /** Replay the feedback-to-job handoff if the process stopped between the two durable writes. */
  private async reconcileJobs(): Promise<void> {
    if (!this.worker) return;
    const events = await this.store.events();
    const feedback = effectiveFeedback(events);
    const attempts = events.filter((event) => event.type === 'attempt_recorded').map((event) => event.attempt);
    const everSolved = new Set(events.flatMap((event) =>
      event.type === 'feedback_recorded' && event.feedback.label === 'solved'
        ? [event.feedback.attempt_id] : [],
    ));
    const latest = new Map<string, string>();
    for (const attempt of attempts) {
      const grade = feedback.get(attempt.attempt_id);
      if (!grade || !everSolved.has(attempt.attempt_id)) continue;
      const prev = latest.get(attempt.interaction_id);
      if (!prev || prev < grade.timestamp) latest.set(attempt.interaction_id, grade.timestamp);
    }
    for (const [id, timestamp] of latest) {
      const jobId = (await this.queue.enqueueKnowledge(id)).job_id;
      const job = await this.queue.get(jobId);
      if (job && ['completed', 'failed'].includes(job.status) && job.updated_at < timestamp) {
        await this.queue.enqueueKnowledge(id, { requeueCompleted: true });
      }
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
      mkdir(join(this.store.root, 'datasets', 'eval'), { recursive: true }),
      mkdir(join(this.store.root, 'datasets', 'embedding'), { recursive: true }),
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
