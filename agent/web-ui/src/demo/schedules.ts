import type { ScheduleSummary } from '@agent/core/schedules/summary';
import { scheduledFollowUpMessage } from '@agent/core/schedules/messages';

const jobs: ScheduleSummary[] = [
  { id: 'demo-background', chatId: 'demo-chat-two', chatTitle: 'API review', chatDeleted: false,
    kind: 'background', backgroundStatus: 'running', prompt: 'mcp_kafka_scan_messages', status: 'running',
    createdAt: Date.now() - 600_000 },
  { id: 'demo-hourly', chatId: 'demo-chat-one', chatTitle: 'Indexing investigation', chatDeleted: false,
    prompt: 'Check for source changes and summarize the affected indexing paths.', status: 'scheduled',
    dueAt: Date.now() + 600_000, everySeconds: 3600, createdAt: Date.now() - 300_000, model: 'Demo model' },
  { id: 'demo-active', chatId: 'demo-chat-two', chatTitle: 'API review', chatDeleted: false,
    prompt: 'Review the completed API checks and report any failures.', status: 'running',
    dueAt: Date.now() - 60_000, createdAt: Date.now() - 300_000, activeRun: { id: 'demo-run', stopping: false } },
  { id: 'demo-failed', chatId: 'demo-chat-three', chatTitle: 'Dependency audit', chatDeleted: false,
    prompt: 'Recheck the dependency audit after the external tool finishes.', status: 'failed',
    afterToolCallId: 'audit-check', createdAt: Date.now() - 600_000, error: 'Provider unavailable. Restore the connection and create a new schedule.' },
];

/** Simulated schedules belong only to the demo transport. */
export function scheduleDemoResponse(url: URL, init?: RequestInit): Response | undefined {
  if (url.pathname === '/api/schedules') return Response.json(jobs);
  if (url.pathname === '/api/sessions' && !init?.method) return Response.json(jobs.filter((job, index) => jobs.findIndex((item) => item.chatId === job.chatId) === index).map((job) => ({
    id: job.chatId, title: job.chatTitle, createdAt: job.createdAt, updatedAt: job.createdAt,
    turns: 1, pinned: false, archived: false,
  })));

  const chat = jobs.find((job) => url.pathname === `/api/sessions/${job.chatId}`);
  if (chat && !init?.method) return Response.json({
    id: chat.chatId, title: chat.chatTitle, createdAt: chat.createdAt, updatedAt: chat.createdAt,
    messages: [
      scheduledFollowUpMessage(`${chat.id}-question`, chat.id, chat.prompt),
      { id: `${chat.id}-answer`, role: 'assistant', parts: [{ type: 'text', text: 'This simulated scheduled check has been saved in its originating chat. Expand Scheduled runs above to inspect this chat’s jobs.' }] },
    ],
  });

  const match = /^\/api\/schedules\/([^/]+)\/cancel$/.exec(url.pathname);
  if (!match) return;
  if (init?.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const job = jobs.find((item) => item.id === match[1]);
  if (!job) return new Response('not found', { status: 404 });

  const stopping = Boolean(job.activeRun);
  job.status = 'cancelled';
  if (job.kind === 'background') job.backgroundStatus = 'cancelled';
  job.activeRun = undefined;

  return Response.json({ id: job.id, stopping, kind: job.kind });
}
