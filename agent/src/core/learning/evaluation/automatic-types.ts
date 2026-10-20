import type { Generator, ReasoningEffort } from '../../types.js';
import type { RetrievalReport, RetrievalRun } from '../metrics/types.js';
import type { RepositoryVersion } from '../types.js';
import type { EvalScore, OutputReport, OutputRun } from './types.js';

export interface EvaluationModel {
  key: string;
  model: string;
  effort: ReasoningEffort;
  contextWindow: number;
}

export interface EvaluationConfiguration {
  candidate: EvaluationModel;
  judge: EvaluationModel;
}

export type CandidateOutput = Omit<OutputRun, 'eval_id'> & Omit<RetrievalRun, 'eval_id'>;

export interface EvaluationRuntime {
  configuration(): Promise<EvaluationConfiguration | undefined>;
  /** Only the held-out question reaches the candidate, never its oracle or history. */
  candidate(question: string, configuration: EvaluationConfiguration): Promise<CandidateOutput>;
  judge(configuration: EvaluationConfiguration): Generator;
}

export interface EvaluationTask {
  id: string;
  harness_version: 1;
  example_id: string;
  source_revision: string;
  configuration: EvaluationConfiguration;
  repositories: RepositoryVersion[];
}

export interface AutomaticEvalReport extends EvaluationTask {
  updated_at: string;
  status: 'completed' | 'retrying' | 'failed' | 'superseded' | 'skipped';
  reason?: string;
  report?: OutputReport;
  retrieval?: RetrievalReport;
}

export interface EvaluationCheckpoint {
  candidate?: CandidateOutput;
  scores: EvalScore[];
}
