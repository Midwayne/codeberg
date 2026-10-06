import type { UIMessage } from 'ai';
import { writeModuleLog } from '../../module-log.js';
import type { FeedbackLabel, FeedbackRating, FeedbackRecord } from '../types.js';
import { wakeWorker } from './settings.js';
import type { LearningServiceState } from './state.js';

export async function recordSession(
  state: LearningServiceState,
  conversationId: string,
  messages: UIMessage[],
  parentConversationId?: string,
): Promise<void> {
  if (!state.preferences.enabled || !state.preferences.history || !state.preferences.historyCapture)
    return;

  const attempts = await state.store.recordSession(conversationId, messages, parentConversationId);
  const newIds = new Set(attempts.map((attempt) => attempt.attempt_id));
  for (const id of new Set(attempts.map((attempt) => attempt.interaction_id))) {
    const interaction = await state.store.interaction(id);
    const newAnswers = interaction.attempts.filter(
      (attempt) => newIds.has(attempt.attempt_id) && attempt.answer.trim(),
    );
    if (!newAnswers.length) continue;

    if (
      state.datasetEnabled &&
      (interaction.feedback.length || newAnswers.some((attempt) => attempt.tools_invoked.length))
    ) {
      await state.queue.enqueueDataset(id, { requeueCompleted: true });
    }

    if (
      state.knowledgeCaptureEnabled &&
      interaction.feedback.some((feedback) => feedback.label === 'solved')
    ) {
      await state.queue.enqueueKnowledge(id, { requeueCompleted: true });
    } else {
      writeModuleLog('learning-agent', 'knowledge_not_queued', {
        interaction_id: id,
        reason: 'no_solved_feedback',
      });
    }

    wakeWorker(state);
  }
}

export async function feedback(
  state: LearningServiceState,
  input: {
    conversationId: string;
    messageId: string;
    rating: FeedbackRating;
    label: FeedbackLabel;
    reason?: string;
  },
): Promise<{ feedback: FeedbackRecord; jobId?: string; jobStatus?: string }> {
  if (!state.preferences.enabled || !state.preferences.history || !state.preferences.historyCapture)
    throw new Error('Learning history is paused. Enable it in Settings.');

  const attempt = await state.store.attemptForMessage(input.conversationId, input.messageId);
  if (!attempt) throw new Error('attempt not found; wait for the conversation to finish saving');

  const feedback = await state.store.recordFeedback({
    attemptId: attempt.attempt_id,
    rating: input.rating,
    label: input.label,
    reason: input.reason,
  });

  await enqueueFeedbackDataset(state, attempt.interaction_id);

  // A change to an older attempt can invalidate knowledge learned from a newer
  // solved attempt (or vice versa). Revisit the entire logical interaction.
  const interaction = await state.store.interaction(attempt.interaction_id);
  if (
    !state.knowledgeCaptureEnabled ||
    !interaction.feedback.some((entry) => entry.label === 'solved')
  ) {
    writeModuleLog('learning-agent', 'knowledge_not_queued', {
      interaction_id: attempt.interaction_id,
      reason: 'no_solved_feedback',
    });

    return { feedback };
  }

  return enqueueFeedbackKnowledge(state, attempt.interaction_id, feedback);
}

async function enqueueFeedbackDataset(
  state: LearningServiceState,
  interactionId: string,
): Promise<void> {
  try {
    if (state.datasetEnabled)
      await state.queue.enqueueDataset(interactionId, { requeueCompleted: true });

    wakeWorker(state);
  } catch (error) {
    console.error('dataset job enqueue failed; feedback is saved:', error);
    writeModuleLog('learning-agent', 'dataset_enqueue_failed', { error: String(error) });
  }
}

async function enqueueFeedbackKnowledge(
  state: LearningServiceState,
  interactionId: string,
  feedback: FeedbackRecord,
): Promise<{ feedback: FeedbackRecord; jobId?: string; jobStatus?: string }> {
  try {
    const job = await state.queue.enqueueKnowledge(interactionId, {
      requeueCompleted: true,
    });
    wakeWorker(state);

    return { feedback, jobId: job.job_id, jobStatus: job.status };
  } catch (error) {
    // The feedback event is already durable. Reconcile this handoff on startup.
    console.error('knowledge job enqueue failed; feedback is saved:', error);
    writeModuleLog('learning-agent', 'knowledge_enqueue_failed', { error: String(error) });

    return { feedback };
  }
}
