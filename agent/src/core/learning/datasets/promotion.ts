import { EXTRACTION_VERSION, isCurrentExample } from '../dataset-extract.js';
import { sameTaskFamily } from '../dedup.js';
import { writeJsonImmutable } from '../fs.js';
import { redactSecrets } from '../redact.js';
import { sourceRevision } from '../revision.js';
import { withPromotionLock } from './lock.js';
import { type DatasetExample, exampleFiles, type Provenance, validateReview } from './records.js';
import type { DatasetStoreState } from './state.js';
import { list, path } from './storage.js';
import { LearningError } from '../errors.js';

export async function promote(
  state: DatasetStoreState,
  id: string,
  split: 'eval' | 'training',
  review: { provenance: Provenance; oracle?: Record<string, unknown> },
): Promise<DatasetExample> {
  const example = (await list(state, 'candidates')).find((row) => row.id === id);
  if (!example) throw new LearningError('not_found', 'candidate not found');

  if (example.extraction_version !== EXTRACTION_VERSION)
    throw new LearningError(
      'conflict',
      'candidate was extracted with an obsolete schema; re-extract and review',
    );

  const current = await state.store.interaction(example.source_interaction_id);
  if (example.source_revision !== sourceRevision(current.attempts, current.feedback)) {
    throw new LearningError(
      'conflict',
      'candidate is stale; extract the latest feedback revision before promotion',
    );
  }

  validateReview(example, split, review);

  return withPromotionLock(state, async () => {
    await validateReservation(state, example, split);

    const promoted = redactSecrets({
      ...example,
      state: split,
      review: { ...review, timestamp: new Date().toISOString() },
      ...(split === 'eval'
        ? { confidence: 'verified' as const, provenance: review.provenance }
        : {}),
    });

    if (!(await writeJsonImmutable(path(state, split, id), promoted)))
      throw new LearningError('conflict', 'already promoted');

    return promoted;
  });
}

export async function dismiss(state: DatasetStoreState, id: string): Promise<DatasetExample> {
  const example = (await list(state, 'candidates')).find((row) => row.id === id);
  if (!example) throw new LearningError('not_found', 'candidate not found');

  const current = await state.store.interaction(example.source_interaction_id);
  if (!isCurrentExample(example, sourceRevision(current.attempts, current.feedback)))
    throw new LearningError('conflict', 'candidate is stale');

  return withPromotionLock(state, async () => {
    const reviewed = await Promise.all(
      (['training', 'eval', 'dismissed'] as const).map((bucket) => list(state, bucket)),
    );
    if (reviewed.some((rows) => rows.some((row) => row.id === id))) {
      throw new LearningError('conflict', 'already reviewed');
    }

    const dismissed: DatasetExample = {
      ...example,
      state: 'dismissed',
      review: { provenance: 'user_confirmed', timestamp: new Date().toISOString() },
    };

    if (!(await writeJsonImmutable(path(state, 'dismissed', id), dismissed)))
      throw new LearningError('conflict', 'already reviewed');

    return dismissed;
  });
}

export async function validateReservation(
  state: DatasetStoreState,
  example: DatasetExample,
  split: 'eval' | 'training',
): Promise<void> {
  const otherSplit = split === 'eval' ? 'training' : 'eval';
  const other = await list(state, otherSplit);
  const files = exampleFiles(example);
  if (
    other.some(
      (row) =>
        row.source_interaction_id === example.source_interaction_id ||
        sameTaskFamily(
          { query: row.query, files: exampleFiles(row) },
          { query: example.query, files },
        ),
    )
  ) {
    throw new LearningError('conflict', 'query or semantic duplicate reserved for opposite split');
  }

  if ((await list(state, split)).some((row) => row.id === example.id))
    throw new LearningError('conflict', 'already promoted');

  if ((await list(state, 'dismissed')).some((row) => row.id === example.id))
    throw new LearningError('conflict', 'already dismissed');
}
