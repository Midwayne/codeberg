import { useMemo, type CSSProperties } from 'react';

import { artBoxStyle, artImageStyle, spriteStyle } from '../lib/backdrop-art-style';
import { sanitizeSvg, svgUrl } from '../lib/svg-sanitize';
import type { BackdropArt, BackdropSprite } from '../lib/theme-types';

/*
 * A drawing as an image. One that animates inside also gets a still copy for
 * reduced motion, since CSS cannot pause the animation inside an image.
 */
function ArtImage({ svg, className, style }: { svg: string; className: string; style?: CSSProperties }) {
  const urls = useMemo(() => {
    const still = /<animate/.test(svg) ? sanitizeSvg(svg, false) : undefined;

    return { moving: svgUrl(svg), still: still && svgUrl(still) };
  }, [svg]);

  if (!urls.still) return <img alt="" className={className} draggable={false} src={urls.moving} style={style} />;

  return (
    <picture>
      <source media="(prefers-reduced-motion: reduce)" srcSet={urls.still} />
      <img alt="" className={className} draggable={false} src={urls.moving} style={style} />
    </picture>
  );
}

/** Model-drawn art at the window's edges and corners. */
export function BackdropArtPieces({ art }: { art: BackdropArt[] }) {
  return art.map((piece, index) => (
    <span key={index} className="backdrop-art" data-anchor={piece.anchor} style={artBoxStyle(piece)}>
      <ArtImage className="backdrop-art-image" svg={piece.svg} style={artImageStyle(piece)} />
    </span>
  ));
}

/** Model-drawn particles, such as petals, scattered and moving across the window. */
export function BackdropSprites({ sprites }: { sprites: BackdropSprite[] }) {
  return (
    <span className="backdrop-sprites">
      {sprites.flatMap((sprite, layer) =>
        Array.from({ length: sprite.count }, (_, index) => (
          <span
            key={`${layer}-${index}`}
            className="backdrop-sprite"
            data-animation={sprite.animation}
            style={spriteStyle(sprite, index, layer)}
          >
            <ArtImage className="backdrop-sprite-image" svg={sprite.svg} />
          </span>
        )),
      )}
    </span>
  );
}
