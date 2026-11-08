import { FEEDBACK_LABELS, type FeedbackLabel, type FeedbackRating } from '@agent/core/learning/types.js';
import { responseJson } from './response.js';

const FEEDBACK_TITLES: Record<FeedbackLabel, string> = {
  not_useful: 'Not useful',
  partially_useful: 'Partially useful',
  mostly_correct: 'Mostly correct',
  solved: 'Solved',
};

export const FEEDBACK_OPTIONS: { rating: FeedbackRating; label: FeedbackLabel; title: string }[] =
  FEEDBACK_LABELS.map((label, index) => ({
    rating: index as FeedbackRating,
    label,
    title: FEEDBACK_TITLES[label],
  }));

export type FeedbackOption = (typeof FEEDBACK_OPTIONS)[number];

export interface FeedbackRecord {
  feedback_id: string;
  rating: number;
  label: FeedbackOption['label'];
}

export async function loadFeedback(
  conversationId: string,
  messageId: string,
  fetcher: typeof fetch = fetch,
): Promise<FeedbackRecord | null> {
  try {
    const params = new URLSearchParams({ conversation_id: conversationId, message_id: messageId });
    const response = await fetcher(`/api/learning/feedback?${params}`);
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
  fetcher: typeof fetch = fetch,
): Promise<FeedbackRecord> {
  const response = await fetcher('/api/learning/feedback', {
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
  const result = await responseJson<{ feedback: FeedbackRecord }>(response);

  return result.feedback;
}
