import type { UIMessage } from 'ai';

/** Keep the actual continuation in model history while identifying its author to the UI. */
export function scheduledFollowUpMessage(id: string, scheduleId: string, prompt: string): UIMessage {
  return {
    id,
    role: 'user',
    metadata: { codeberg: { kind: 'scheduled-follow-up', scheduleId } },
    parts: [{ type: 'text', text: prompt }],
  };
}

export function isScheduledFollowUp(message: { role: string; metadata?: unknown }): boolean {
  const metadata = message.metadata;
  if (message.role !== 'user' || !metadata || typeof metadata !== 'object' || !('codeberg' in metadata)) return false;

  const origin = metadata.codeberg;

  return Boolean(origin && typeof origin === 'object'
    && 'kind' in origin && origin.kind === 'scheduled-follow-up'
    && 'scheduleId' in origin && typeof origin.scheduleId === 'string' && origin.scheduleId.length > 0);
}
