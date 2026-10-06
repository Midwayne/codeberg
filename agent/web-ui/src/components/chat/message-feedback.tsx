import { useProjectApi } from '../../lib/project-api';
import { CircleAlert } from 'lucide-react';

import { useEffect, useRef, useState } from 'react';

import { Select } from '../ui';

import { cn } from '../../lib/utils';
import { FEEDBACK_OPTIONS, loadFeedback, rateAttempt, type FeedbackOption } from '../../lib/learning';

export type FeedbackActionsProps = { conversationId: string; messageId: string };

export function FeedbackActions(props: FeedbackActionsProps) {
  const state = useFeedbackActions(props);

  return <FeedbackActionsView {...state} />;
}

export type FeedbackActionsOptions = { conversationId: string; messageId: string };

export function useFeedbackActions({ conversationId, messageId }: FeedbackActionsOptions) {
  const { fetch: api } = useProjectApi();
  const [selected, setSelected] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    savingRef.current = false;
    setSaving(false);
    setSelected(undefined);
    setFailed(false);
    void loadFeedback(conversationId, messageId, api).then((feedback) => {
      if (request === generation.current && !savingRef.current) setSelected(feedback?.label);
    });
    return () => {
      generation.current++;
    };
  }, [conversationId, messageId, api]);

  async function choose(option: FeedbackOption): Promise<void> {
    if (savingRef.current) return;
    savingRef.current = true;
    const request = ++generation.current;
    const previous = selected;
    setSaving(true);
    setFailed(false);
    setSelected(option.label);
    try {
      const feedback = await rateAttempt(conversationId, messageId, option, undefined, api);
      if (request === generation.current) setSelected(feedback.label);
    } catch {
      if (request === generation.current) {
        setSelected(previous);
        setFailed(true);
      }
    } finally {
      if (request === generation.current) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  }
  return { saving, selected, choose, failed };
}

export type FeedbackActionsViewProps = ReturnType<typeof useFeedbackActions>;

export function FeedbackActionsView({ saving, selected, choose, failed }: FeedbackActionsViewProps) {
  return (
    <div
      role="group"
      aria-label="Rate this answer"
      aria-busy={saving}
      className="ml-1 flex flex-wrap items-center gap-2"
    >
      <Select
        aria-label="Rate this answer"
        value={selected ?? ''}
        disabled={saving}
        onChange={(event) => {
          const option = FEEDBACK_OPTIONS.find((entry) => entry.label === event.currentTarget.value);
          if (option) void choose(option);
        }}
        className={cn('text-muted-foreground sm:min-h-9 sm:text-xs', selected && 'text-foreground')}
      >
        <option value="" disabled={selected !== undefined} className="bg-popover text-popover-foreground">
          Rate answer
        </option>
        {FEEDBACK_OPTIONS.map((option) => (
          <option key={option.label} value={option.label} className="bg-popover text-popover-foreground">
            {option.title}
          </option>
        ))}
      </Select>
      {saving && (
        <span role="status" className="sr-only">
          Saving rating…
        </span>
      )}
      {failed && (
        <span role="status" className="inline-flex max-w-48 items-start gap-1.5 text-xs text-destructive">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          Feedback wasn't saved. Select a rating to retry.
        </span>
      )}
    </div>
  );
}
