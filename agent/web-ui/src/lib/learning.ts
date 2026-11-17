import { ensureOk, jsonInit } from './http';

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

type ConversationRatings = Record<string, FeedbackRecord | undefined>;

/** In-flight reads per API client: a chat's answers mount together and share one request. */
const pending = new WeakMap<typeof fetch, Map<string, Promise<ConversationRatings>>>();

export async function loadFeedback(
  conversationId: string,
  messageId: string,
  fetcher: typeof fetch = fetch,
): Promise<FeedbackRecord | null> {
  const ratings = await conversationRatings(conversationId, fetcher);

  return Object.hasOwn(ratings, messageId) ? ratings[messageId] ?? null : null;
}

function conversationRatings(conversationId: string, fetcher: typeof fetch): Promise<ConversationRatings> {
  const requests = pending.get(fetcher) ?? new Map<string, Promise<ConversationRatings>>();
  pending.set(fetcher, requests);

  const existing = requests.get(conversationId);
  if (existing) return existing;

  // Forget the request once it settles, so a later open sees ratings saved elsewhere.
  const request = fetchRatings(conversationId, fetcher).finally(() => requests.delete(conversationId));
  requests.set(conversationId, request);

  return request;
}

async function fetchRatings(conversationId: string, fetcher: typeof fetch): Promise<ConversationRatings> {
  try {
    const params = new URLSearchParams({ conversation_id: conversationId });
    const response = await fetcher(`/api/learning/feedback?${params}`);

    return response.ok ? (((await response.json()) as ConversationRatings | null) ?? {}) : {};
  } catch {
    return {};
  }
}

export async function rateAttempt(
  conversationId: string,
  messageId: string,
  option: FeedbackOption,
  reason?: string,
  fetcher: typeof fetch = fetch,
): Promise<FeedbackRecord> {
  const response = await fetcher('/api/learning/feedback', jsonInit('POST', {
      conversation_id: conversationId,
      message_id: messageId,
      rating: option.rating,
      label: option.label,
      ...(reason ? { reason } : {}),
    }));
  await ensureOk(response);
  const result = (await response.json()) as { feedback: FeedbackRecord };
  return result.feedback;
}
