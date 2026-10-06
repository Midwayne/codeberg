import { extract } from './datasets/extraction.js';
import { withPromotionLock } from './datasets/lock.js';
import { dismiss, promote } from './datasets/promotion.js';
import type { DatasetExample, DatasetKind, Provenance } from './datasets/records.js';
import { DatasetStoreState } from './datasets/state.js';
import { active, list } from './datasets/storage.js';
import { LearningStore } from './store.js';

/** Append-only, sanitized candidates. Only explicitly reviewed examples enter held-out eval or training. */
export class DatasetStore {
  private readonly state: DatasetStoreState;

  constructor(store: LearningStore) {
    this.state = new DatasetStoreState(store);
  }

  get store(): LearningStore {
    return this.state.store;
  }

  list(bucket: 'candidates' | 'eval' | 'training' | 'dismissed'): Promise<DatasetExample[]> {
    return list(this.state, bucket);
  }

  /** Eligible reviewed rows; list() remains the immutable historical view. */
  active(split: 'eval' | 'training'): Promise<DatasetExample[]> {
    return active(this.state, split);
  }

  extract(
    interactionId: string,
    kinds?: Partial<Record<DatasetKind, boolean>>,
  ): Promise<DatasetExample[]> {
    return extract(this.state, interactionId, kinds);
  }

  /** Reserve the entire query family, not just the example ID, for one split. */
  promote(
    id: string,
    split: 'eval' | 'training',
    review: { provenance: Provenance; oracle?: Record<string, unknown> },
  ): Promise<DatasetExample> {
    return promote(this.state, id, split, review);
  }

  /** A deliberate review decision; never delete the original candidate. */
  dismiss(id: string): Promise<DatasetExample> {
    return dismiss(this.state, id);
  }

  withPromotionLock<T>(action: () => Promise<T>): Promise<T> {
    return withPromotionLock(this.state, action);
  }
}

export { EXTRACTION_VERSION } from './dataset-extract.js';

export { similar } from './dedup.js';

export { sourceRevision } from './revision.js';

export type { DatasetExample, DatasetKind, Provenance } from './datasets/records.js';

export { exampleFiles } from './datasets/records.js';
