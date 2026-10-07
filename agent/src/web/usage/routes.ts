import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, sendText } from '../http.js';
import type { UsageRecord } from '../../core/usage.js';
import type { UsageStore } from './store.js';
import { summarizeUsage } from './summary.js';

export async function routeUsage(req: IncomingMessage, res: ServerResponse, store: UsageStore, url: URL) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return sendText(res, 405, 'method not allowed');

  const range = parseRange(url.searchParams);
  if (!range) return sendText(res, 400, 'Choose valid UTC dates within one year and a positive page number.');

  const rows = await store.read(range.start, range.end);
  if (url.searchParams.get('format') === 'csv') {
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="codeberg-usage-${range.start}.csv"` });
    res.end(usageCsv(rows));

    return;
  }

  const pageSize = 25;
  sendJson(res, 200, { ...summarizeUsage(rows), ...range, pageSize, failedWrites: store.failedWrites,
    records: rows.slice((range.page - 1) * pageSize, range.page * pageSize) });
}

function parseRange(params: URLSearchParams) {
  const today = new Date();
  const start = params.get('start') ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const end = params.get('end') ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1)).toISOString().slice(0, 10);
  const page = params.get('page') ?? '1';

  if (!validDate(start) || !validDate(end) || !/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page))) return;

  const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
  if (days <= 0 || days > 366) return;

  return { start, end, page: Number(page) };
}

function validDate(value: string) {
  const timestamp = Date.parse(value);

  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(timestamp)
    && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function usageCsv(rows: UsageRecord[]) {
  const header = 'Date (UTC),Project,Type,Model,Model key,Input tokens,Output tokens,Cache read tokens,Cache write tokens,Estimated cost (USD)';
  const lines = rows.map((row) => [new Date(row.timestamp).toISOString(), row.projectName ?? row.project ?? 'Unassigned',
    row.kind, row.model, row.key, row.inputTokens, row.outputTokens, row.cacheReadTokens, row.cacheWriteTokens, row.costUsd]
    .map(csvCell).join(','));

  return [header, ...lines, ''].join('\r\n');
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;

  return `"${safe.replaceAll('"', '""')}"`;
}
