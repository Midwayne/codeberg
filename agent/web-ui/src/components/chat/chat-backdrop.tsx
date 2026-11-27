import { useState } from 'react';

import { useActiveTheme } from '../../lib/use-active-theme';
import { useBackdropShown } from '../../lib/use-backdrop-shown';
import type { CustomBackdrop } from '../../lib/theme-types';
import { CustomBackdropLayers } from '../custom-backdrop';
import { SceneFrame } from '../scene-frame';

/*
 * The scene behind the sidebar and conversation. Built-in scenes are pure CSS keyed on the
 * root's data-backdrop; generated ones also draw their layers here. CSS hides
 * the element when backdrops are off. A model-written scene runs in place of its
 * layers, art, and particles, which come back if the scene stops.
 */
export function ChatBackdrop() {
  const { backdrop, palette, colorScheme } = useActiveTheme();
  const shown = useBackdropShown();
  const [stopped, setStopped] = useState<string>();

  const custom = typeof backdrop === 'object' ? backdrop : undefined;
  const scene = custom?.scene;
  const live = scene && shown && stopped !== scene.script ? scene : undefined;

  const onFail = (reason: string, detail: string) => {
    console.warn(`The theme's scene stopped (${reason})${detail ? `: ${detail}` : ''}; showing its still backdrop.`);
    setStopped(scene?.script);
  };

  return (
    <div aria-hidden="true" className="chat-backdrop">
      {custom && <CustomBackdropLayers backdrop={live ? skyOnly(custom) : custom} />}
      {live && <SceneFrame colorScheme={colorScheme} colors={palette} scene={live} onFail={onFail} />}
    </div>
  );
}

function skyOnly(backdrop: CustomBackdrop): CustomBackdrop {
  return backdrop.sky ? { sky: backdrop.sky, layers: [] } : { layers: [] };
}
