import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isCurrentExample } from '../dataset-extract.js';
import { interactionRevisions } from '../revision.js';
import type { DatasetExample } from './records.js';
import type { DatasetStoreState } from './state.js';

export const DATASET_BUCKETS = ['candidates', 'eval', 'training', 'dismissed'] as const;

export type DatasetBucket = (typeof DATASET_BUCKETS)[number];

export function path(state: DatasetStoreState, bucket: string, id: string): string {
  return join(state.store.root, 'datasets', bucket, `${id}.json`);
}

export async function list(
  state: DatasetStoreState,
  bucket: DatasetBucket,
): Promise<DatasetExample[]> {
  const dir = join(state.store.root, 'datasets', bucket);
  let files: string[];
  try {
    files = (await readdir(dir)).filter((file) => file.endsWith('.json'));
  } catch {
    return [];
  }

  const examples: DatasetExample[] = [];
  for (const file of files) {
    try {
      examples.push(JSON.parse(await readFile(join(dir, file), 'utf8')) as DatasetExample);
    } catch {
      /* ignore incomplete legacy files */
    }
  }

  return examples;
}

export async function active(
  state: DatasetStoreState,
  split: 'eval' | 'training',
): Promise<DatasetExample[]> {
  const revisions = interactionRevisions(await state.store.events());

  return (await list(state, split)).filter((row) =>
    isCurrentExample(row, revisions.get(row.source_interaction_id)),
  );
}
