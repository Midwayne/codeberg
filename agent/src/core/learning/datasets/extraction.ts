import { extractExamples } from '../dataset-extract.js';
import { writeJsonImmutable } from '../fs.js';
import { effectiveFeedback } from '../store.js';
import type { DatasetExample, DatasetKind } from './records.js';
import type { DatasetStoreState } from './state.js';
import { path } from './storage.js';

export async function extract(
  state: DatasetStoreState,
  interactionId: string,
  kinds?: Partial<Record<DatasetKind, boolean>>,
): Promise<DatasetExample[]> {
  const { attempts, feedback } = await state.store.interaction(interactionId);
  const grades = effectiveFeedback(await state.store.events());
  const examples = extractExamples(interactionId, attempts, feedback, grades).filter(
    (example) => !kinds || kinds[example.kind] !== false,
  );
  for (const example of examples) {
    // Retries are idempotent; never overwrite historical candidates.
    await writeJsonImmutable(path(state, 'candidates', example.id), example);
  }

  return examples;
}
