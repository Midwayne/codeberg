import type { AttemptRecord, FeedbackRecord, KnowledgeArtifact } from './types.js';

export interface LearningSearchHit {
  score: number;
  attempt: AttemptRecord;
  feedback?: FeedbackRecord;
}

export interface KnowledgeSearchHit {
  score: number;
  artifact: KnowledgeArtifact;
}
