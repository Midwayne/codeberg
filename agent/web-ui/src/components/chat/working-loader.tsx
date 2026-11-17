import type { CSSProperties } from 'react';

import './working-loader.css';

export const loaderVariants = ['cube', 'tiles', 'stack', 'split'] as const;
export type LoaderVariant = (typeof loaderVariants)[number];

/* The first turn shows the cube; later turns cycle so the loader stays fresh within one chat. */
export function loaderForTurn(turn: number): LoaderVariant {
  return loaderVariants[Math.max(0, turn - 1) % loaderVariants.length]!;
}

type WorkingLoaderProps = { variant: LoaderVariant };

/* A small decorative loader; the surrounding status region carries the accessible text. */
export function WorkingLoader({ variant }: WorkingLoaderProps) {
  return (
    <span aria-hidden="true" className="working-loader" data-loader={variant}>
      <LoaderParts variant={variant} />
    </span>
  );
}

function LoaderParts({ variant }: WorkingLoaderProps) {
  switch (variant) {
    case 'cube':
      return <Parts className="loader-cube" part="loader-cube-face" names={['front', 'back', 'right', 'left', 'top', 'bottom']} />;
    case 'tiles':
      /* DOM order is row by row; --i staggers them clockwise from the top left. */
      return <Parts className="loader-tiles" part="loader-tile" names={['0', '1', '3', '2']} />;
    case 'stack':
      return <Parts className="loader-stack" part="loader-plate" names={['0', '1', '2']} />;
    case 'split':
      return <Parts className="loader-split" part="loader-quarter" names={['tl', 'tr', 'bl', 'br']} />;
    default:
      return never(variant);
  }
}

type PartsProps = { className: string; part: string; names: string[] };

function Parts({ className, part, names }: PartsProps) {
  return (
    <span className={className}>
      {names.map((name) => (
        <span key={name} className={part} data-part={name} style={{ '--i': Number(name) || 0 } as CSSProperties} />
      ))}
    </span>
  );
}

function never(value: never): never {
  throw new Error(`Unknown loader: ${String(value)}`);
}
