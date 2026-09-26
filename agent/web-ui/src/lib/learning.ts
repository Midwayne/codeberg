export const FEEDBACK_OPTIONS = [
  { rating: 0, label: 'not_useful', title: 'Not useful' },
  { rating: 1, label: 'partially_useful', title: 'Partially useful' },
  { rating: 2, label: 'mostly_correct', title: 'Mostly correct' },
  { rating: 3, label: 'solved', title: 'Solved' },
] as const;

export type FeedbackOption = (typeof FEEDBACK_OPTIONS)[number];

export interface FeedbackRecord {
  feedback_id: string;
  rating: number;
  label: FeedbackOption['label'];
}


export async function loadFeedback(
  conversationId: string,
  messageId: string,
): Promise<FeedbackRecord | null> {
  try {
    const params = new URLSearchParams({ conversation_id: conversationId, message_id: messageId });
    const response = await fetch(`/api/learning/feedback?${params}`);
    return response.ok ? ((await response.json()) as FeedbackRecord | null) : null;
  } catch {
    return null;
  }
}

export async function rateAttempt(
  conversationId: string,
  messageId: string,
  option: FeedbackOption,
  reason?: string,
): Promise<FeedbackRecord> {
  const response = await fetch('/api/learning/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_id: conversationId,
      message_id: messageId,
      rating: option.rating,
      label: option.label,
      ...(reason ? { reason } : {}),
    }),
  });
  if (!response.ok) throw new Error(await response.text());
  const result = (await response.json()) as { feedback: FeedbackRecord };
  return result.feedback;
}
