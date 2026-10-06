import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectDreamingKnowledge } from '../dreaming/projection.js';
import { DreamingReports } from '../dreaming/reports.js';
import { memorySourceState, type SourceObservation } from '../memory-source.js';
import { interactionRevisions } from '../revision.js';
import type { KnowledgeArtifact } from '../types.js';
import { parseArtifact } from './artifact.js';
import { readEvents } from './events.js';
import { readRepositories } from './interactions.js';
import type { LearningStoreState } from './state.js';

export async function currentKnowledgeArtifacts(
  state: LearningStoreState,
): Promise<KnowledgeArtifact[]> {
  return (await freshKnowledgeArtifacts(state, await projectedKnowledgeArtifacts(state))).map(
    (artifact) => {
      if (!artifact.user_confirmed_notes?.length) return artifact;

      const { user_confirmed_notes: _notes, ...verified } = artifact;

      return {
        ...verified,
        body: artifact.body.split('\n## User-confirmed notes (not source-verified)\n')[0].trim(),
      };
    },
  );
}

export async function freshKnowledgeArtifacts(
  state: LearningStoreState,
  artifacts: KnowledgeArtifact[],
): Promise<KnowledgeArtifact[]> {
  const [events, repositories] = await Promise.all([readEvents(state), readRepositories(state)]);
  const revisions = interactionRevisions(events);
  const feedbackFresh = artifacts.filter(
    (artifact) =>
      artifact.status === 'active' &&
      artifact.source_interactions.length > 0 &&
      artifact.source_interactions.every(
        (id) =>
          (artifact.source_revisions?.[id] ??
            (artifact.source_interactions.length === 1 ? artifact.source_revision : undefined)) ===
            revisions.get(id) && revisions.has(id),
      ),
  );

  const sourceCache = new Map<string, Promise<SourceObservation>>();
  const states = await Promise.all(
    feedbackFresh.map(async (artifact) => ({
      artifact,
      fresh: (await memorySourceState(artifact, repositories, sourceCache)).fresh,
    })),
  );

  return states.filter((entry) => entry.fresh).map(({ artifact }) => artifact);
}

export async function projectedKnowledgeArtifacts(
  state: LearningStoreState,
): Promise<KnowledgeArtifact[]> {
  const artifacts = await knowledgeArtifacts(state);
  const reports = new DreamingReports(state.root);
  // Existing installations pay no extra source scan when no view is applied.
  const applied = (await reports.list()).filter((report) => report.status === 'applied');
  if (!applied.length) return artifacts;

  const freshIds = new Set(
    (await freshKnowledgeArtifacts(state, artifacts)).map((artifact) => artifact.id),
  );

  return projectDreamingKnowledge(artifacts, applied, freshIds);
}

export async function knowledgeArtifacts(state: LearningStoreState): Promise<KnowledgeArtifact[]> {
  const artifacts: KnowledgeArtifact[] = [];
  for (const category of ['services', 'flows', 'concepts', 'debugging'] as const) {
    let files: string[];
    try {
      files = (await readdir(join(state.root, 'knowledge', category))).filter((file) =>
        file.endsWith('.md'),
      );
    } catch {
      continue;
    }

    for (const file of files) {
      try {
        artifacts.push(
          parseArtifact(await readFile(join(state.root, 'knowledge', category, file), 'utf8')),
        );
      } catch {
        // One malformed artifact must not hide the rest of the knowledge base.
      }
    }
  }

  return artifacts;
}
