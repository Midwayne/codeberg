import { useEffect, useState } from 'react';

import {
  loadSubagentProgress,
  progressPart,
  settled,
  type DetachedSubagents,
  type SubagentProgress,
} from '../../lib/background-subagents';
import { startPoll } from '../../lib/poll';
import { useProjectApi } from '../../lib/project-api';
import type { ToolView } from './message';
import { SubagentRun } from './subagent-run';

/** How often a running detached run refreshes, and how long to wait after a failed read. */
const LIVE_MS = 2_000;

const RETRY_MS = 10_000;

/**
 * `run_subagents` started with `start_background_tool`: the same live card as
 * a foreground run, fed from the background job, so it keeps updating while
 * the agent sleeps and shows the reports once the job settles.
 */
export function DetachedSubagentRun({ detached }: { detached: DetachedSubagents }) {
  const progress = useSubagentProgress(detached.chatId, detached.jobId);
  const badge = settled(progress) ? 'Background' : 'In background';

  return <SubagentRun name={detached.name} part={progressPart(detached.args, progress) as ToolView} badge={badge} />;
}

function useSubagentProgress(chatId: string, jobId: string): SubagentProgress | undefined {
  const { fetch: api } = useProjectApi();
  const [progress, setProgress] = useState<SubagentProgress>();

  useEffect(() => {
    const poll = startPoll({
      load: (signal) => loadSubagentProgress(api, chatId, jobId, signal),
      done: (value) => {
        setProgress(value);

        return settled(value) ? undefined : LIVE_MS;
      },
      fail: () => RETRY_MS,
      timeoutMs: 15_000,
    });

    return () => poll.stop();
  }, [api, chatId, jobId]);

  return progress;
}
