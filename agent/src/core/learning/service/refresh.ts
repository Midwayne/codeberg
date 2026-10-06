import { memorySourceState, sourceKey, type SourceObservation } from '../memory-source.js';
import { stableId } from '../store.js';
import { syncWatcher, wakeWorker } from './settings.js';
import type { LearningServiceState } from './state.js';

export function refreshKnowledge(
  state: LearningServiceState,
  sources?: Iterable<string>,
): Promise<void> {
  if (
    !state.knowledgeEnabled ||
    !state.preferences.knowledgeRefresh ||
    state.stopping ||
    state.maintenance
  )
    return Promise.resolve();

  if (sources) for (const source of sources) state.pendingSources.add(source);
  else state.fullScanRequested = true;

  state.checking ??= drainScans(state).finally(() => {
    state.checking = undefined;
  });

  return state.checking;
}

export async function drainScans(state: LearningServiceState): Promise<void> {
  while (state.fullScanRequested || state.pendingSources.size) {
    const sources = state.fullScanRequested ? undefined : new Set(state.pendingSources);
    state.fullScanRequested = false;
    state.pendingSources.clear();
    await scanKnowledge(state, sources);
  }
}

export async function scanKnowledge(
  state: LearningServiceState,
  sources?: Set<string>,
): Promise<void> {
  const [artifacts, repositories] = await Promise.all([
    state.store.knowledgeArtifacts(),
    state.store.repositories(),
  ]);

  const sourceCache = new Map<string, Promise<SourceObservation>>();
  for (const artifact of artifacts) {
    if (state.stopping || !state.knowledgeEnabled || !state.preferences.knowledgeRefresh) return;

    if (!state.preferences.categories[artifact.category]) continue;

    if (sources && !artifact.source_refs?.some((ref) => sources.has(sourceKey(ref)))) continue;

    const sourceState = await memorySourceState(artifact, repositories, sourceCache);
    if (sourceState.fresh && artifact.status !== 'needs_verification') continue;

    for (const id of artifact.source_interactions) {
      const job = await state.queue.get(stableId('job', 'extract_knowledge', id));
      if (
        job?.source_code_revision === sourceState.revision &&
        ['completed', 'failed'].includes(job.status)
      )
        continue;

      await state.queue.enqueueKnowledge(id, { requeueCompleted: true, sourceRefresh: true });
    }
  }

  wakeWorker(state);
  await syncWatcher(state);
}
