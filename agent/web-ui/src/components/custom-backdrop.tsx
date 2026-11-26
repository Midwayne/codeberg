import { layerStyle, skyStyle } from '../lib/backdrop-layers';
import type { CustomBackdrop } from '../lib/theme-types';

/* Draws a generated backdrop inside a positioned container. */
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
    </>
  );
}
