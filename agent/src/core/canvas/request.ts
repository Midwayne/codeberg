/**
 * Message metadata the composer's Diagram toggle sets on one user message.
 * Only that message's turn gets the canvas tools and instructions; every
 * other turn leaves them out of the request.
 */
export const DIAGRAM_REQUEST = { codeberg: { diagram: true } } as const;

type MessageLike = { role?: unknown; metadata?: unknown };

/** Whether the newest user message asked for a diagram. */
export function diagramRequested(messages: readonly unknown[]): boolean {
  const latest = [...messages].reverse().find((message): message is MessageLike =>
    Boolean(message) && typeof message === 'object' && (message as MessageLike).role === 'user');

  const metadata = latest?.metadata;
  if (!metadata || typeof metadata !== 'object' || !('codeberg' in metadata)) return false;

  const codeberg = (metadata as { codeberg?: unknown }).codeberg;

  return Boolean(codeberg) && typeof codeberg === 'object' && (codeberg as { diagram?: unknown }).diagram === true;
}
