import type { UIMessage } from 'ai';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';

import type { Generator } from '../types.js';
import { DurableJobQueue } from './queue.js';
import { LearningStore, defaultLearningRoot } from './store.js';
import type { FeedbackLabel, FeedbackRating, FeedbackRecord } from './types.js';
import { KnowledgeWorker } from './worker.js';

export class LearningService {
  readonly store: LearningStore;
  readonly queue: DurableJobQueue;
  readonly worker?: KnowledgeWorker;

  constructor(options: { root?: string; generator?: Generator } = {}) {
    const root = options.root ?? defaultLearningRoot();
    this.store = new LearningStore(root);
    this.queue = new DurableJobQueue(root);
    if (options.generator) this.worker = new KnowledgeWorker(this.store, this.queue, options.generator);
  }

  async initialize(): Promise<void> {
    await this.ensureLayout();
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
    const job = await this.queue.enqueueKnowledge(attempt.interaction_id, {
      requeueCompleted: true,
    });
    this.worker?.wake();
    return { feedback, jobId: job.job_id, jobStatus: job.status };
  }

  isWorking(): boolean {
    return this.worker?.isRunning() ?? false;
  }

  async waitForCurrent(): Promise<void> {
    await this.worker?.waitForCurrent();
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
