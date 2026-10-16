import { useLayoutEffect, useRef } from 'react';

/** Retained media must pause when Activity hides the chat or it unmounts. */
export function usePauseMedia() {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;

    return () => {
      for (const media of root?.querySelectorAll<HTMLMediaElement>('audio, video') ?? []) {
        media.pause();
      }
    };
  }, []);

  return ref;
}
