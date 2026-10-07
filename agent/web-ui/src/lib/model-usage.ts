import type { UsageReport } from '@agent/core/usage';

export type UsageRange = { start: string; end: string };
export const usagePresets = [['1d', '1d'], ['7d', '7d'], ['30d', '30d'], ['mtd', 'MTD'], ['last-month', 'Last month']] as const;
const date = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

export function usageRange(preset: string, now = new Date()): UsageRange {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const month = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);

  if (preset === 'last-month') return { start: date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), end: date(month) };

  return { start: date(preset === 'mtd' ? month : today - (Number.parseInt(preset) - 1) * 86_400_000),
    end: date(today + 86_400_000) };
}

export const inclusiveEnd = (end: string) => date(Date.parse(end) - 86_400_000);
export const exclusiveEnd = (end: string) => end ? date(Date.parse(end) + 86_400_000) : '';
export const usageQuery = (range: UsageRange, page = 1) => new URLSearchParams({ ...range, page: String(page) }).toString();

export async function loadUsage(range: UsageRange, page: number, api: typeof fetch, signal: AbortSignal): Promise<UsageReport> {
  const response = await api(`/api/settings/usage?${usageQuery(range, page)}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(await response.text());

  return response.json() as Promise<UsageReport>;
}

export async function exportUsage(range: UsageRange, api: typeof fetch) {
  const response = await api(`/api/settings/usage?${usageQuery(range)}&format=csv`, { cache: 'no-store' });
  if (!response.ok) throw new Error(await response.text());

  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `codeberg-usage-${range.start}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatCost(value: number | null): string {
  if (value === null) return 'Unavailable';
  if (value > 0 && value < 0.0001) return '<$0.0001';

  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD',
    minimumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2 }).format(value);
}

export const formatTokens = (value: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
