import { useEffect, useMemo, useState } from 'react';
import type { ScheduleSummary } from '@agent/core/schedules/summary';
import { useProjectApi } from './project-api';
import { ScheduleRequests } from './schedule-requests';

export function useScheduledRuns() {
  const { fetch: api } = useProjectApi();
  const [jobs, setJobs] = useState<ScheduleSummary[]>();
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [cancellingId, setCancellingId] = useState<string>();
  const [notice, setNotice] = useState('');
  const [feedbackChatId, setFeedbackChatId] = useState<string>();
  const requests = useMemo(() => new ScheduleRequests(api, { jobs: setJobs, loading: setLoading,
    readError: setReadError, cancelError: setCancelError, busy: setCancellingId, notice: setNotice }), [api]);

  useEffect(() => {
    requests.activate();
    void requests.refresh();
    const refreshVisible = () => {
      if (!document.hidden) void requests.refresh();
    };
    const timer = window.setInterval(refreshVisible, 5000);
    document.addEventListener('visibilitychange', refreshVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisible);
      requests.close();
    };
  }, [requests]);

  return { jobs, loading, cancellingId, notice, readError, cancelError, feedbackChatId, error: cancelError || readError,
    onRefresh: () => void requests.refresh(), onCancel: (id: string) => {
      setFeedbackChatId(jobs?.find((job) => job.id === id)?.chatId);
      void requests.cancel(id);
    } };
}
