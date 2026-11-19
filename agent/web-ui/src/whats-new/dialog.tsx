import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import { Streamdown } from 'streamdown';

import { buttonClass } from '../components/button-styles';
import { Dialog } from '../components/dialog';
import { bundledReleases } from './changelog';
import { pendingVersions, type Release } from './releases';
import '../components/onboarding.css';
import '../docs/styles.css';
import './whats-new.css';

type WhatsNewDialogProps = {
  since: string | null;
  version: string;
  onClose: () => void;
  releases?: Release[];
};

/** Release notes for every version installed since the last visit, newest open. */
export function WhatsNewDialog({ since, version, onClose, releases = bundledReleases }: WhatsNewDialogProps) {
  const shown = notesToShow(releases, since, version);
  const gotIt = useRef<HTMLButtonElement>(null);

  // showModal focuses the first release; start on the dismiss action instead.
  useEffect(() => gotIt.current?.focus({ preventScroll: true }), []);

  // A release without notes (or a trimmed changelog) has nothing to announce.
  useEffect(() => {
    if (shown.length === 0) onClose();
  }, [shown.length, onClose]);

  if (shown.length === 0) return null;

  return (
    <Dialog label="What's new in Codeberg" onClose={onClose} className="m-auto w-[min(40rem,calc(100vw-2rem))]">
      <WhatsNewHeader version={version} count={shown.length} />
      <div className="max-h-[calc(100dvh-16rem)] min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {shown.map((release, index) => (
          <ReleaseNotes key={release.version} release={release} step={index + 1} open={index === 0} />
        ))}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
        <a href="/docs/whats-new" target="_blank" rel="noopener noreferrer"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          All release notes
        </a>
        <button type="button" ref={gotIt} onClick={onClose}
          className="onboard-cta min-h-11 rounded-lg bg-primary px-4 text-sm text-primary-foreground md:min-h-9">
          Got it
        </button>
      </footer>
    </Dialog>
  );
}

function notesToShow(releases: Release[], since: string | null, version: string): Release[] {
  const versions = pendingVersions(releases, since, version);

  return versions.map((wanted) => releases.find((release) => release.version === wanted)!);
}

function WhatsNewHeader({ version, count }: { version: string; count: number }) {
  const lead = count > 1
    ? `You're on ${version}. Here's what changed in the last ${count} releases.`
    : `You're on ${version}. Here's what changed.`;

  return (
    <header className="flex items-start gap-4 border-b border-border px-5 py-5">
      <span aria-hidden="true" className="whats-new-badge grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
        <Sparkles className="whats-new-sparkle size-5" />
      </span>
      <div data-onboard-step="0">
        <h2 className="text-lg font-semibold">What's new in Codeberg</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{lead}</p>
      </div>
    </header>
  );
}

type ReleaseNotesProps = { release: Release; step: number; open: boolean };

function ReleaseNotes({ release, step, open }: ReleaseNotesProps) {
  return (
    <details open={open} data-onboard-step={Math.min(step, 4)} className="whats-new-release group rounded-lg border border-border bg-card">
      <summary className={`${buttonClass} flex cursor-pointer list-none items-center justify-between gap-3 border-0`}>
        <span className="font-semibold">v{release.version}</span>
        <span className="ml-auto text-xs text-muted-foreground">{release.date}</span>
        <ChevronDown aria-hidden="true" className="whats-new-chevron size-4 text-muted-foreground" />
      </summary>
      <div className="whats-new-notes docs-prose px-4 pb-4">
        <Streamdown mode="static" components={markdownComponents} controls={{ table: false }} linkSafety={{ enabled: false }}>
          {release.body}
        </Streamdown>
      </div>
    </details>
  );
}

// Links open in a new tab so following one never discards the chat underneath.
function NotesLink({ href, children }: { href?: string; children?: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}

const markdownComponents = { a: NotesLink };
