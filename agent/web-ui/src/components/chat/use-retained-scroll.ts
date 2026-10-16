import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Activity hides DOM with display:none, which can reset a scroll viewport. */
export function useRetainedScroll(scrollRef: RefObject<HTMLDivElement | null>) {
  const position = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    if (position.current !== undefined) element.scrollTop = position.current;

    const remember = () => {
      position.current = element.scrollTop;
    };

    element.addEventListener('scroll', remember, { passive: true });

    return () => {
      // A hidden viewport reports zero dimensions; keep its last visible value.
      if (element.clientHeight > 0) remember();
      element.removeEventListener('scroll', remember);
    };
  }, [scrollRef]);
}
