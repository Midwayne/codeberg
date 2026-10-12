import { useEffect, useLayoutEffect, useState, type MouseEvent } from 'react';
import { instantMotion } from '../lib/motion-input';
import { docsDestination, fragmentId, topicMotion, type TopicMotion } from './routing';

type DocsRoute = { path: string; motion: TopicMotion; hash: string; focus: boolean };

/** Keep navigation chrome stable while topics change; native history still works. */
export function useDocsRoute(initialPath: string) {
  const [route, setRoute] = useState<DocsRoute>({ path: initialPath, motion: 'instant', hash: '', focus: false });

  useEffect(() => {
    const restore = () => setRoute({
      path: window.location.pathname,
      motion: 'instant',
      hash: window.location.hash,
      focus: false,
    });

    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  useTopicFocus(route);

  function navigate(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;

    const anchor = event.target.closest<HTMLAnchorElement>('a');
    if (!anchor) return;

    const destination = docsDestination(anchor.href, window.location.href, event,
      anchor.target, anchor.hasAttribute('download'));
    if (!destination) return;

    event.preventDefault();
    if (destination.pathname === route.path) return;

    const motion = topicMotion(route.path, destination.pathname, event.detail, instantMotion());
    window.history.pushState(null, '', destination.href);
    setRoute({ path: destination.pathname, motion, hash: destination.hash, focus: true });
  }

  function select(href: string) {
    const destination = new URL(href, window.location.href);
    if (destination.href !== window.location.href) window.history.pushState(null, '', destination.href);

    setRoute({ path: destination.pathname, motion: 'instant', hash: destination.hash, focus: true });
  }

  return { ...route, navigate, select };
}

function useTopicFocus(route: DocsRoute) {
  useLayoutEffect(() => {
    if (!route.focus) return;

    window.scrollTo({ top: 0, behavior: 'instant' });
    const heading = document.getElementById(route.hash ? fragmentId(route.hash) : 'doc-title');
    if (route.hash) heading?.scrollIntoView({ block: 'start', behavior: 'instant' });

    heading?.focus({ preventScroll: true });
  }, [route]);
}
