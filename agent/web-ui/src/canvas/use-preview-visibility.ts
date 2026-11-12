import { useLayoutEffect, useRef } from 'react';

import { postPreviewVisibility } from './preview-visibility';

/**
 * Hidden Activity trees keep iframe documents alive. Tell the embedded canvas
 * when its chat is hidden so it stops polling for scene changes.
 */
export function usePreviewVisibility() {
  const ref = useRef<HTMLIFrameElement>(null);
  const shown = useRef(false);

  useLayoutEffect(() => {
    const frame = ref.current;
    shown.current = true;
    postPreviewVisibility(frame, true);

    return () => {
      shown.current = false;
      postPreviewVisibility(frame, false);
    };
  }, []);

  const onLoad = () => postPreviewVisibility(ref.current, shown.current);

  return { ref, onLoad };
}
