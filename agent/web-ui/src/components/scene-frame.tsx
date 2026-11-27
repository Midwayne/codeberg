import { useMemo, useRef } from 'react';

import { SCENE_SANDBOX, sceneDocument } from '../lib/scene/scene-document';
import type { Palette, SceneScript } from '../lib/theme-types';
import { useReducedMotion, useSceneFrame } from './use-scene-frame';

type SceneFrameProps = {
  scene: SceneScript;
  colors: Palette;
  colorScheme: 'dark' | 'light';
  onFail: (reason: string, detail: string) => void;
};

/** A model-written scene, drawn in a sandboxed frame behind the conversation. */
export function SceneFrame(props: SceneFrameProps) {
  const reduced = useReducedMotion();
  const motion = props.scene.motion && !reduced;

  return <SceneDocument key={sceneFrameKey(props, motion)} {...props} motion={motion} />;
}

/** The frame gets its page, colors, and motion once, at start, so changing any of them starts a fresh one. */
export function sceneFrameKey({ scene, colors, colorScheme }: Pick<SceneFrameProps, 'scene' | 'colors' | 'colorScheme'>, motion: boolean): string {
  return [motion, colorScheme, JSON.stringify(colors), scene.script].join('\n');
}

function SceneDocument({ scene, colors, colorScheme, onFail, motion }: SceneFrameProps & { motion: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const page = useMemo(() => sceneDocument(colorScheme), [colorScheme]);
  const onLoad = useSceneFrame({ frame, script: scene.script, colors, motion, onFail });

  return (
    <iframe
      ref={frame}
      aria-hidden="true"
      className="backdrop-scene-frame"
      onLoad={onLoad}
      referrerPolicy="no-referrer"
      sandbox={SCENE_SANDBOX}
      srcDoc={page}
      tabIndex={-1}
      title="Theme scene"
    />
  );
}
