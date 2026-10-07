import { useEffect, useState } from 'react';
import { useProjectApi } from './project-api';
import { exportUsage, loadUsage, usageRange, type UsageRange } from './model-usage';
import type { UsageReport } from '@agent/core/usage';

export function useModelUsage() {
  const { fetch: api } = useProjectApi();
  const [range, setRange] = useState(() => usageRange('mtd'));
  const [preset, setPreset] = useState('mtd');
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<UsageReport>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void loadUsage(range, page, api, controller.signal).then((value) => {
      if (!controller.signal.aborted) setReport(value);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(String(failure));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });

    return () => controller.abort();
  }, [range, page, retry, api]);

  const onRange = (value: UsageRange) => {
    setRange(value);
    setPreset('custom');
    setPage(1);
  };

  const onPreset = (value: string) => {
    onRange(usageRange(value));
    setPreset(value);
  };

  return { range, preset, page, report, error, loading, exporting, onRange, onPreset, onPage: setPage,
    onRetry: () => setRetry((value) => value + 1),
    onExport: () => runExport(range, api, setExporting, setError) };
}

async function runExport(range: UsageRange, api: typeof fetch, setBusy: (value: boolean) => void, setError: (value: string) => void) {
  setBusy(true);
  setError('');

  try {
    await exportUsage(range, api);
  } catch (failure) {
    setError(String(failure));
  } finally {
    setBusy(false);
  }
}
