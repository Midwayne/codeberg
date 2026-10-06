import type { AttemptRecord, FeedbackRecord, RepositoryVersion } from '../types.js';
import { readEvents } from './events.js';
import { effectiveFeedback } from './feedback.js';
import { knowledgeArtifacts } from './knowledge.js';
import type { LearningStoreState } from './state.js';

export function readRepositories(state: LearningStoreState): Promise<RepositoryVersion[]> {
  return state.repositoryProvider();
}

export async function attemptForMessage(
  state: LearningStoreState,
  conversationId: string,
  messageId: string,
): Promise<AttemptRecord | undefined> {
  return (await attempts(state))
    .filter(
      (attempt) =>
        attempt.conversation_id === conversationId && attempt.assistant_message_id === messageId,
    )
    .at(-1);
}

export async function currentFeedback(
  state: LearningStoreState,
  attemptId: string,
): Promise<FeedbackRecord | undefined> {
  return effectiveFeedback(await readEvents(state)).get(attemptId);
}

export async function interaction(
  state: LearningStoreState,
  interactionId: string,
): Promise<{
  attempts: AttemptRecord[];
  feedback: FeedbackRecord[];
}> {
  const events = await readEvents(state);
  const attempts = events.flatMap((event) =>
    event.type === 'attempt_recorded' && event.attempt.interaction_id === interactionId
      ? [event.attempt]
      : [],
  );

  const ids = new Set(attempts.map((attempt) => attempt.attempt_id));
  const feedback = events.flatMap((event) =>
    event.type === 'feedback_recorded' && ids.has(event.feedback.attempt_id)
      ? [event.feedback]
      : [],
  );

  return { attempts, feedback };
}

export async function attempts(state: LearningStoreState): Promise<AttemptRecord[]> {
  const byId = new Map<string, AttemptRecord>();
  for (const event of await readEvents(state)) {
    if (event.type === 'attempt_recorded') byId.set(event.attempt.attempt_id, event.attempt);
  }

  return [...byId.values()];
}

export async function stats(state: LearningStoreState): Promise<Record<string, number>> {
  const events = await readEvents(state);
  const attempts = events.filter((event) => event.type === 'attempt_recorded');
  const feedback = events.filter((event) => event.type === 'feedback_recorded');

  return {
    conversations: new Set(attempts.map((event) => event.attempt.conversation_id)).size,
    interactions: new Set(attempts.map((event) => event.attempt.interaction_id)).size,
    attempts: new Set(attempts.map((event) => event.attempt.attempt_id)).size,
    feedback_events: feedback.length,
    knowledge_artifacts: (await knowledgeArtifacts(state)).length,
  };
}
