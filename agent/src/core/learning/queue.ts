import { enqueueDataset, enqueueDreaming, enqueueKnowledge } from './queue/enqueue.js';
import { claim, complete, fail, release } from './queue/execution.js';
import { DEFAULT_LEASE_MS, isTransientFailure } from './queue/policy.js';
import { reconcileStates, recoverExpired, recoverRetryableFailures } from './queue/recovery.js';
import { counts, nextDueAt } from './queue/scheduling.js';
import { DurableJobQueueState } from './queue/state.js';
import { get, list } from './queue/storage.js';
import type { FailureCategory, JobStatus, KnowledgeJob } from './types.js';

export class DurableJobQueue {
  private readonly state: DurableJobQueueState;

  constructor(root: string, now: () => Date = () => new Date(), leaseMs = DEFAULT_LEASE_MS) {
    this.state = new DurableJobQueueState(root, now, leaseMs);
  }

  get root(): string {
    return this.state.root;
  }

  enqueueKnowledge(
    interactionId: string,
    options: { requeueCompleted?: boolean; sourceRefresh?: boolean } = {},
  ): Promise<KnowledgeJob> {
    return enqueueKnowledge(this.state, interactionId, options);
  }

  enqueueDataset(
    interactionId: string,
    options: { requeueCompleted?: boolean; sourceRefresh?: boolean } = {},
  ): Promise<KnowledgeJob> {
    return enqueueDataset(this.state, interactionId, options);
  }

  enqueueDreaming(runId: string): Promise<KnowledgeJob> {
    return enqueueDreaming(this.state, runId);
  }

  recoverExpired(): Promise<number> {
    return recoverExpired(this.state);
  }

  /** Earliest pending retry or abandoned lease, including a claim with no lease. */
  nextDueAt(
    type?: KnowledgeJob['type'],
    enabled: (job: KnowledgeJob) => boolean = () => true,
  ): Promise<number | undefined> {
    return nextDueAt(this.state, type, enabled);
  }

  /** Reconcile a crash between writing the new state and deleting the old file. */
  reconcileStates(): Promise<void> {
    return reconcileStates(this.state);
  }

  /** Migrates retryable jobs failed by older one-shot queue policies back to pending. */
  recoverRetryableFailures(): Promise<number> {
    return recoverRetryableFailures(this.state);
  }

  claim(
    type?: KnowledgeJob['type'],
    enabled: (job: KnowledgeJob) => boolean = () => true,
  ): Promise<KnowledgeJob | undefined> {
    return claim(this.state, type, enabled);
  }

  /** Put a claimed but unexecuted job back without counting pause as a failure. */
  release(job: KnowledgeJob): Promise<void> {
    return release(this.state, job);
  }

  complete(job: KnowledgeJob): Promise<void> {
    return complete(this.state, job);
  }

  fail(
    job: KnowledgeJob,
    category: FailureCategory,
    error: string,
    transient = isTransientFailure(category),
  ): Promise<void> {
    return fail(this.state, job, category, error, transient);
  }

  counts(): Promise<Record<JobStatus, number>> {
    return counts(this.state);
  }

  get(jobId: string): Promise<KnowledgeJob | undefined> {
    return get(this.state, jobId);
  }

  list(status: JobStatus): Promise<KnowledgeJob[]> {
    return list(this.state, status);
  }
}

export { classifyFailure, isTransientFailure } from './queue/policy.js';
