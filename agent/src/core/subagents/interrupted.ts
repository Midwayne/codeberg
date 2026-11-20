import { SUBAGENT_TOOL_NAMES } from './names.js';
import type { SubagentReport } from './run.js';

const INTERRUPTED = 'Interrupted before it finished.';

type Snapshot = { results?: unknown };

/**
 * The result to record for a subagent call whose run ended mid-way: the last
 * live snapshot, with each finished report restored to its full text (live
 * snapshots carry it in full once, then as a preview) and unfinished
 * subagents marked failed. Undefined when no progress names any subagent.
 */
function interruptedSubagentOutput(progress: readonly unknown[]): { results: SubagentReport[] } | undefined {
  const snapshots = progress.map((item) => (item as Snapshot | undefined)?.results).filter(Array.isArray) as SubagentReport[][];
  const last = snapshots.at(-1);
  if (!last || last.length === 0) return undefined;

  const full = fullReports(snapshots);

  return { results: last.map((report) => settle(report, full.get(report.agent_id))) };
}

function fullReports(snapshots: SubagentReport[][]): Map<string, string> {
  const full = new Map<string, string>();

  for (const snapshot of snapshots) {
    for (const report of snapshot) {
      if (report.report && !report.report_truncated) full.set(report.agent_id, report.report);
    }
  }

  return full;
}

function settle(report: SubagentReport, fullReport: string | undefined): SubagentReport {
  const { activity: _activity, started_at: _started, report_truncated: _truncated, ...rest } = report;
  const unfinished = report.status === 'queued' || report.status === 'running';

  if (unfinished) return { ...rest, status: 'failed', error: INTERRUPTED };

  return fullReport ? { ...rest, report: fullReport } : rest;
}

/** How each subagent tool keeps finished work when its run is interrupted. */
export const SUBAGENT_INTERRUPTED_OUTPUTS: Record<string, (progress: readonly unknown[]) => unknown> =
  Object.fromEntries(SUBAGENT_TOOL_NAMES.map((name) => [name, interruptedSubagentOutput]));
