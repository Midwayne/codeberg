import type { FeedbackRecord } from '../types.js';
import { defaultLearningRoot } from './identity.js';
import { repositoryVersions } from './repositories.js';

/** Current ratings by conversation, then assistant message id. */
export type ConversationFeedbackIndex = Map<string, Map<string, FeedbackRecord>>;

/** Valid while every event file keeps this identity (name, inode, size and mtime). */
export type CachedFeedbackIndex = { version: string; index: Promise<ConversationFeedbackIndex> };

export class LearningStoreState {
  readonly root: string;

  writeChain: Promise<void> = Promise.resolve();

  /** Chat views ask for ratings on every open; re-parse the log only after it changes. */
  feedbackIndex?: CachedFeedbackIndex;

  constructor(
    root = defaultLearningRoot(),
    readonly repositoryProvider = repositoryVersions,
  ) {
    this.root = root;
  }
}
