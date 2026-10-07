import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SceneFade } from './scene-fade';

export function useSceneMotion() {
  const surface = useRef<HTMLDivElement>(null);
  const fade = useMemo(() => new SceneFade(() => surface.current), []);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [updated, setUpdated] = useState(false);
  const transition = useCallback((animate: boolean) => {
    if (!animate) return;

    fade.capture();
    setUpdated(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setUpdated(false), 1200);
  }, [fade]);

  useEffect(() => {
    const cancel = () => fade.cancel();
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    preference.addEventListener('change', cancel);
    const container = surface.current;
    container?.addEventListener('pointerdown', cancel, true);
    container?.addEventListener('keydown', cancel, true);

    return () => {
      clearTimeout(timer.current);
      preference.removeEventListener('change', cancel);
      container?.removeEventListener('pointerdown', cancel, true);
      container?.removeEventListener('keydown', cancel, true);
      fade.cancel();
    };
  }, [fade]);

  return { surface, transition, updated };
}
