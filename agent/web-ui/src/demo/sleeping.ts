import type { ScheduleSummary } from '@agent/core/schedules/summary';

/** `?subagents=background`: the agent detached its subagents and went to sleep until they finish. */
export const sleepingDemo = new URLSearchParams(location.search).get('subagents') === 'background';

const JOB = 'demo-fan';

const WAKE = 'demo-wake';

const dueAt = Date.now() + 25 * 60_000;

const tasks = [
  { description: 'Scan checkout error logs', prompt: 'Scan the last 24h of checkout logs for timeouts and group them by upstream.' },
  { description: 'Compare billing latency', prompt: 'Compare billing p99 latency this week against last week and flag regressions.', agent_type: 'worker' },
];

/** The detached run and the sleep that waits on it, as the assistant turn left them. */
export function sleepingDemoParts() {
  const call = (id: string, toolName: string, input: unknown, output: unknown) =>
    ({ type: 'dynamic-tool', toolName, toolCallId: id, state: 'output-available', input, output });

  return [
    call('demo-start', 'start_background_tool', { tool: 'run_subagents', args: { tasks } },
      { id: JOB, tool: 'run_subagents', status: 'running', createdAt: Date.now() - 90_000 }),
    { type: 'text', text: 'Both sweeps run in the background; I will read their reports as soon as they finish.' },
    call('demo-sleep', 'sleep_agent', { prompt: 'Read both subagent reports and summarize the regressions.', delay_seconds: 1500, job_ids: [JOB] },
      { sleeping: true, wake: { id: WAKE, status: 'scheduled', dueAt, backgroundJobIds: [JOB] } }),
  ];
}

export function sleepingDemoJob(chatId: string, chatTitle: string): ScheduleSummary {
  return { id: WAKE, chatId, chatTitle, chatDeleted: false, prompt: 'Read both subagent reports and summarize the regressions.',
    status: 'scheduled', dueAt, backgroundJobIds: [JOB], createdAt: Date.now() - 60_000 };
}

export function sleepingDemoProgress(url: URL): Response | undefined {
  if (url.pathname !== `/api/schedules/${JOB}/subagents`) return undefined;

  return Response.json({ id: JOB, status: 'running', results: [
    { agent_id: 'sa_bg0', description: tasks[0]!.description, agent_type: 'explorer', status: 'completed', tool_calls: 4,
      steps: 5, elapsed_ms: 48_000, report: 'Most timeouts come from the payments gateway between 02:00 and 03:00 UTC.' },
    { agent_id: 'sa_bg1', description: tasks[1]!.description, agent_type: 'worker', status: 'running', tool_calls: 3,
      steps: 4, started_at: Date.now() - 80_000, activity: 'run_script · latency_compare.py' },
  ] });
}
