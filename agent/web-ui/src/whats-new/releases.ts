/** One published section of CHANGELOG.md, e.g. `## [0.1.15] - 2026-11-12`. */
export type Release = { version: string; date: string; body: string };

const RELEASE_HEADING = /^## \[(\d+\.\d+\.\d+)\](?:\s*-\s*(\S+))?\s*$/;

const ANY_HEADING = /^## /;

const LINK_REFERENCE = /^\[[^\]]+\]:\s*\S+/;

/** Released sections, newest first as written; `[Unreleased]` and link references are dropped. */
export function parseReleases(changelog: string): Release[] {
  const releases: Release[] = [];
  let current: { version: string; date: string; lines: string[] } | undefined;

  const finish = () => {
    if (current) releases.push({ version: current.version, date: current.date, body: current.lines.join('\n').trim() });

    current = undefined;
  };

  for (const line of changelog.split('\n')) {
    const heading = RELEASE_HEADING.exec(line);

    if (heading) {
      finish();
      current = { version: heading[1]!, date: heading[2] ?? '', lines: [] };
    } else if (ANY_HEADING.test(line)) {
      finish();
    } else if (current && !LINK_REFERENCE.test(line)) {
      current.lines.push(line);
    }
  }

  finish();

  return releases;
}

/**
 * Versions installed after `since`, up to and including `current`, newest first.
 * Without a usable `since`, only the current release is shown. Development and
 * pre-release builds have no notes.
 */
export function pendingVersions(releases: Release[], since: string | null, current: string, limit = 3): string[] {
  const installed = parseVersion(current);
  if (!installed) return [];

  const previous = since === null ? undefined : parseVersion(since);
  const newer = (version: number[]) => compareVersions(version, installed) <= 0
    && (previous ? compareVersions(version, previous) > 0 : compareVersions(version, installed) === 0);

  return releases
    .filter((release) => newer(parseVersion(release.version)!))
    .sort((left, right) => compareVersions(parseVersion(right.version)!, parseVersion(left.version)!))
    .slice(0, limit)
    .map((release) => release.version);
}

/** Every release as one docs page, with a `##` heading per version. */
export function releaseNotesMarkdown(releases: Release[]): string {
  return releases
    .map((release) => {
      const title = release.date ? `v${release.version} · ${release.date}` : `v${release.version}`;

      return `## ${title}\n\n${release.body}`;
    })
    .join('\n\n');
}

/** Stable MAJOR.MINOR.PATCH only, with or without a leading `v`. */
export function parseVersion(raw: string): number[] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(raw.trim());

  return match ? match.slice(1).map(Number) : undefined;
}

export function compareVersions(left: number[], right: number[]): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }

  return 0;
}
