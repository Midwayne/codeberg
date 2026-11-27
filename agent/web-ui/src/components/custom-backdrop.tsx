import { layerStyle, skyStyle } from '../lib/backdrop-layers';
import { BackdropArtPieces, BackdropSprites } from './backdrop-art';
import type { CustomBackdrop } from '../lib/theme-types';

/* Draws a layered backdrop, then its particles and art, inside a positioned container. */
export function CustomBackdropLayers({ backdrop }: { backdrop: CustomBackdrop }) {
  const sky = skyStyle(backdrop);

  return (
    <>
      {sky && <span className="backdrop-layer" style={sky} />}
      {backdrop.layers.map((layer, index) => (
        <span
          key={index}
          className="backdrop-layer"
          data-kind={layer.kind}
          data-animation={layer.animation}
          style={layerStyle(layer)}
        />
      ))}
      {backdrop.sprites && <BackdropSprites sprites={backdrop.sprites} />}
      {backdrop.art && <BackdropArtPieces art={backdrop.art} />}
    </>
  );
}
