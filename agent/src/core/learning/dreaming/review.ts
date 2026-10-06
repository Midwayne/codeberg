import type { KnowledgeJob } from '../types.js';
import type { DreamingReport } from './types.js';

export type DreamingSummary = Omit<DreamingReport, 'changes'> & {
  changes: { id: string; title: string; status: string; reason: string }[];
};
export interface DreamingDashboard {
  reports: DreamingSummary[];
  jobs: Pick<KnowledgeJob, 'job_id' | 'interaction_id' | 'status' | 'last_error' | 'next_attempt_at'>[];
  canGenerate: boolean;
}
export function dreamingSummary(report: DreamingReport): DreamingSummary {
  return { ...report, changes: report.changes.map(({ after, reason }) => ({ id: after.id, title: after.title, status: after.status, reason })) };
}
