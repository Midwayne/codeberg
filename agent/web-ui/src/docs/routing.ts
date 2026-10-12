import { docPages, findDocPage } from './catalog';

type LinkClick = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

export type TopicMotion = 'instant' | 'forward' | 'backward';

/** Preserve native links unless this is an ordinary same-origin topic selection. */
export function docsDestination(
  href: string,
  current: string,
  click: LinkClick,
  target?: string,
  download = false,
): URL | undefined {
  if (click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return;
  if (download || (target && target !== '_self')) return;

  const base = new URL(current);
  const destination = new URL(href, base);
  if (destination.origin !== base.origin) return;
  if (destination.pathname !== '/docs' && !destination.pathname.startsWith('/docs/')) return;
  if (destination.pathname === base.pathname && destination.hash) return;

  return destination;
}

export function topicMotion(from: string, to: string, detail: number, instant: boolean): TopicMotion {
  if (detail === 0 || instant || from === to) return 'instant';

  const previous = docPages.indexOf(findDocPage(from)!);
  const next = docPages.indexOf(findDocPage(to)!);
  if (previous < 0 || next < 0) return 'instant';

  return next > previous ? 'forward' : 'backward';
}

export function fragmentId(hash: string): string {
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return hash.slice(1);
  }
}
