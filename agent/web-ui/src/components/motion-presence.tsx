import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { ExitTimer } from '../lib/exit-timer';
import { exitDuration } from '../lib/motion-input';

const PresenceContext = createContext(true);

export const useMotionPresence = () => useContext(PresenceContext);

export type MotionPresenceProps = { visible: boolean; exitMs?: number; children: ReactNode };

/** Preserve the last committed content for a visual exit, without keeping modality. */
export function MotionPresence({ visible, exitMs = 150, children }: MotionPresenceProps) {
  const [retained, setRetained] = useState(visible);
  const previous = useRef(children);
  const timer = useRef(new ExitTimer());

  useLayoutEffect(() => {
    if (visible) previous.current = children;
  }, [visible, children]);

  useLayoutEffect(() => {
    if (visible) {
      timer.current.cancel();
      setRetained(true);
    } else {
      timer.current.wait(exitDuration(exitMs), () => setRetained(false));
    }

    return () => timer.current.cancel();
  }, [visible, exitMs]);

  if (!visible && !retained) return null;

  return (
    <PresenceContext.Provider value={visible}>
      {visible ? children : previous.current}
    </PresenceContext.Provider>
  );
}
