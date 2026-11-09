import { join } from 'node:path';
import { readRecordFiles } from '../fs.js';
import { projectDreamingKnowledge } from '../dreaming/projection.js';
import { DreamingReports } from '../dreaming/reports.js';
import { memorySourceState } from '../memory-source.js';
import { type SourceObservation } from '../memory-source/reading.js';
import { KNOWLEDGE_CATEGORIES } from '../preferences.js';
import { interactionRevisions } from '../revision.js';
import type { KnowledgeArtifact } from '../types.js';
import { stripUserNotes } from '../artifact-body.js';
import { artifactRevision, parseArtifact } from './artifact.js';
import { readEvents } from './events.js';
import { readRepositories } from './repositories.js';
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
        body: stripUserNotes(artifact.body),
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
        (id) => revisions.has(id) && artifactRevision(artifact, id) === revisions.get(id),
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
  for (const category of KNOWLEDGE_CATEGORIES) {
    artifacts.push(
      ...(await readRecordFiles(
        join(state.root, 'knowledge', category),
        (file) => file.endsWith('.md'),
        parseArtifact,
      )),
    );
  }

  return artifacts;
}
