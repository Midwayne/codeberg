import { compareVersions, parseVersion } from './releases';

const SEEN_KEY = 'codeberg.whats-new.seen';

/** The last version whose notes this browser showed, or null on a first visit. */
export function readSeenVersion(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

export function recordSeenVersion(version: string): void {
  try {
    localStorage.setItem(SEEN_KEY, version);
  } catch {
    // Private windows and blocked storage just show the notes again next time.
  }
}

export type WhatsNewDecision = { show: false } | { show: true; since: string | null };

/**
 * Show notes when the installed release is newer than the one last seen. A
 * browser that has never recorded a version belongs to someone who already
 * has projects (first-run screens record the version), so they get the
 * current release's notes once.
 */
export function decideWhatsNew(seen: string | null, current: string): WhatsNewDecision {
  const installed = parseVersion(current);
  if (!installed) return { show: false };

  if (seen === null) return { show: true, since: null };

  const previous = parseVersion(seen);
  if (previous && compareVersions(installed, previous) <= 0) return { show: false };

  return { show: true, since: previous ? seen : null };
}
