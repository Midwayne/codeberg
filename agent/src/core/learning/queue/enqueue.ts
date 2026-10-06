import { unlink } from 'node:fs/promises';
import { writeJsonAtomic } from '../fs.js';
import { stableId } from '../store.js';
import type { KnowledgeJob } from '../types.js';
import type { DurableJobQueueState } from './state.js';
import { find, path } from './storage.js';

export async function enqueueKnowledge(
  state: DurableJobQueueState,
  interactionId: string,
  options: { requeueCompleted?: boolean; sourceRefresh?: boolean } = {},
): Promise<KnowledgeJob> {
  return enqueue(state, 'extract_knowledge', interactionId, options);
}

export async function enqueueDataset(
  state: DurableJobQueueState,
  interactionId: string,
  options: { requeueCompleted?: boolean; sourceRefresh?: boolean } = {},
): Promise<KnowledgeJob> {
  return enqueue(state, 'extract_dataset', interactionId, options);
}

export async function enqueueDreaming(
  state: DurableJobQueueState,
  runId: string,
): Promise<KnowledgeJob> {
  return enqueue(state, 'consolidate_knowledge', runId, {});
}

export async function enqueue(
  state: DurableJobQueueState,
  type: KnowledgeJob['type'],
  interactionId: string,
  options: { requeueCompleted?: boolean; sourceRefresh?: boolean },
): Promise<KnowledgeJob> {
  const jobId = stableId('job', type, interactionId);
  const existing = await find(state, jobId);
  if (existing && (await retainExisting(state, existing, options))) return existing;

  const timestamp = state.now().toISOString();
  const job: KnowledgeJob = {
    ...(existing ?? {}),
    job_id: jobId,
    type,
    interaction_id: interactionId,
    source_refresh: options.sourceRefresh === true,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
    attempt_count: options.requeueCompleted ? 0 : (existing?.attempt_count ?? 0),
    status: 'pending',
    next_attempt_at: undefined,
    lease_expires_at: undefined,
    rerun_requested: undefined,
  };

  await writeJsonAtomic(path(state, 'pending', jobId), job);
  if (existing && existing.status !== 'pending') {
    try {
      await unlink(path(state, existing.status, jobId));
    } catch {
      // Stable id keeps a duplicate state file harmless if cleanup is interrupted.
    }
  }

  return job;
}

async function retainExisting(
  state: DurableJobQueueState,
  existing: KnowledgeJob,
  options: { requeueCompleted?: boolean; sourceRefresh?: boolean },
): Promise<boolean> {
  if (existing?.status === 'processing' && options.requeueCompleted) {
    await writeJsonAtomic(path(state, 'processing', existing.job_id), {
      ...existing,
      rerun_requested: true,
      source_refresh: existing.source_refresh && options.sourceRefresh === true,
    });

    return true;
  }

  if (
    existing &&
    !(options.requeueCompleted && ['completed', 'failed'].includes(existing.status))
  ) {
    if (existing.source_refresh && options.requeueCompleted && !options.sourceRefresh) {
      existing.source_refresh = false;
      await writeJsonAtomic(path(state, existing.status, existing.job_id), existing);
    }

    return true;
  }

  return false;
}
