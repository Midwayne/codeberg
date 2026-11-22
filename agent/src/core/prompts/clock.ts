/**
 * Today's date and the server's time zone, so the agent can read "last week",
 * "yesterday", or "tomorrow at 9" without asking. Day granularity only: the
 * block sits before the conversation cache breakpoints, so a per-minute clock
 * would re-bill the whole transcript on every turn.
 */
export function clockContext(now: Date = new Date(), timeZone = localTimeZone()): string {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(now);

  const offset = utcOffset(now, timeZone);

  return `Today is ${date} (${weekday}) in ${timeZone} (UTC${offset}). Use this date for relative times such as "yesterday" or "last week", and the offset for run_at timestamps.`;
}

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function utcOffset(now: Date, timeZone: string): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(now)
    .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';

  const offset = name.replace('GMT', '');

  return offset === '' ? '+00:00' : offset;
}
