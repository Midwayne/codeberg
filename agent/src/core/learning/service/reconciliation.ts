import { interactionRevisions } from '../revision.js';
import { KNOWLEDGE_EXTRACTION_VERSION } from '../worker.js';
import type { LearningServiceState } from './state.js';

/** Replay the feedback-to-job handoff if the process stopped between the two durable writes. */
export async function reconcileJobs(state: LearningServiceState): Promise<void> {
  const events = await state.store.events();
  const interactionForAttempt = new Map(
    events.flatMap((event) =>
      event.type === 'attempt_recorded'
        ? [[event.attempt.attempt_id, event.attempt.interaction_id] as const]
        : [],
    ),
  );

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
    const id =
      event.type === 'attempt_recorded'
        ? event.attempt.interaction_id
        : interactionForAttempt.get(event.feedback.attempt_id);

    if (!id) continue;

    if (everSolved.has(id)) latestKnowledge.set(id, event.timestamp);

    if (
      event.type === 'feedback_recorded' ||
      (event.attempt.answer.trim() && event.attempt.tools_invoked.length)
    ) {
      latestDataset.set(id, event.timestamp);
    }
  }

  for (const [id, timestamp] of latestKnowledge) {
    await reconcileJob(state, 'knowledge', id, timestamp, revisions.get(id));
  }

  for (const [id, timestamp] of latestDataset) {
    await reconcileJob(state, 'dataset', id, timestamp, revisions.get(id));
  }
}

export async function reconcileJob(
  state: LearningServiceState,
  kind: 'knowledge' | 'dataset',
  interactionId: string,
  lastEvent: string,
  revision?: string,
): Promise<void> {
  if (kind === 'knowledge' ? !state.knowledgeCaptureEnabled : !state.datasetEnabled) return;

  const enqueue =
    kind === 'knowledge'
      ? state.queue.enqueueKnowledge.bind(state.queue)
      : state.queue.enqueueDataset.bind(state.queue);

  const jobId = (await enqueue(interactionId)).job_id;
  const job = await state.queue.get(jobId);
  if (
    job &&
    ['completed', 'failed'].includes(job.status) &&
    (job.source_revision !== revision ||
      job.updated_at < lastEvent ||
      (kind === 'knowledge' && job.extraction_version !== KNOWLEDGE_EXTRACTION_VERSION))
  ) {
    await enqueue(interactionId, { requeueCompleted: true });
  }
}
