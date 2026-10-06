import type { UIMessage } from 'ai';
import { readEvents } from './store/events.js';
import { recordFeedback, recordSession } from './store/history.js';
import { defaultLearningRoot } from './store/identity.js';
import {
  attemptForMessage,
  attempts,
  currentFeedback,
  interaction,
  readRepositories,
  stats,
} from './store/interactions.js';
import {
  currentKnowledgeArtifacts,
  knowledgeArtifacts,
  projectedKnowledgeArtifacts,
} from './store/knowledge.js';
import { repositoryVersions } from './store/repositories.js';
import { searchKnowledge, searchLearning } from './store/search.js';
import { LearningStoreState } from './store/state.js';
import type {
  AttemptRecord,
  FeedbackLabel,
  FeedbackRating,
  FeedbackRecord,
  KnowledgeArtifact,
  KnowledgeSearchHit,
  LearningEvent,
  LearningSearchHit,
  RepositoryVersion,
} from './types.js';

export class LearningStore {
  private readonly state: LearningStoreState;

  constructor(root = defaultLearningRoot(), repositoryProvider = repositoryVersions) {
    this.state = new LearningStoreState(root, repositoryProvider);
  }

  get root(): string {
    return this.state.root;
  }

  repositories(): Promise<RepositoryVersion[]> {
    return readRepositories(this.state);
  }

  recordSession(
    conversationId: string,
    messages: UIMessage[],
    parentConversationId?: string,
  ): Promise<AttemptRecord[]> {
    return recordSession(this.state, conversationId, messages, parentConversationId);
  }

  recordFeedback(input: {
    attemptId: string;
    rating: FeedbackRating;
    label: FeedbackLabel;
    reason?: string;
    supersedesFeedbackId?: string;
  }): Promise<FeedbackRecord> {
    return recordFeedback(this.state, input);
  }

  attemptForMessage(conversationId: string, messageId: string): Promise<AttemptRecord | undefined> {
    return attemptForMessage(this.state, conversationId, messageId);
  }

  currentFeedback(attemptId: string): Promise<FeedbackRecord | undefined> {
    return currentFeedback(this.state, attemptId);
  }

  interaction(interactionId: string): Promise<{
    attempts: AttemptRecord[];
    feedback: FeedbackRecord[];
  }> {
    return interaction(this.state, interactionId);
  }

  attempts(): Promise<AttemptRecord[]> {
    return attempts(this.state);
  }

  events(): Promise<LearningEvent[]> {
    return readEvents(this.state);
  }

  searchLearning(query: string, limit = 10): Promise<LearningSearchHit[]> {
    return searchLearning(this.state, query, limit);
  }

  searchKnowledge(
    query: string,
    limit = 10,
    options: {
      includeUnverified?: boolean;
      categories?: Partial<Record<KnowledgeArtifact['category'], boolean>>;
    } = {},
  ): Promise<KnowledgeSearchHit[]> {
    return searchKnowledge(this.state, query, limit, options);
  }

  /** Active facts only, checked against events even before an async invalidation job runs. */
  currentKnowledgeArtifacts(): Promise<KnowledgeArtifact[]> {
    return currentKnowledgeArtifacts(this.state);
  }

  /** Views only hide duplicates while every underlying note remains freshly verified. */
  projectedKnowledgeArtifacts(): Promise<KnowledgeArtifact[]> {
    return projectedKnowledgeArtifacts(this.state);
  }

  knowledgeArtifacts(): Promise<KnowledgeArtifact[]> {
    return knowledgeArtifacts(this.state);
  }

  stats(): Promise<Record<string, number>> {
    return stats(this.state);
  }
}

export { defaultLearningRoot, stableId } from './store/identity.js';

export { repositoryVersions } from './store/repositories.js';

export { effectiveFeedback } from './store/feedback.js';

export { parseArtifact, serializeArtifact } from './store/artifact.js';
