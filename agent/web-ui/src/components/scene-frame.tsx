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

  // A changed scene or motion setting starts a fresh frame, with a fresh page nonce.
  return <SceneDocument key={`${motion}:${props.scene.script}`} {...props} motion={motion} />;
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
