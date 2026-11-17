import type { CSSProperties, ReactNode } from 'react';

import './working-loader.css';
import './working-loader-motion.css';

export const loaderVariants = ['cube', 'roll', 'bounce', 'twist', 'burst', 'stack'] as const;
export type LoaderVariant = (typeof loaderVariants)[number];

/* The first turn shows the cube; later turns cycle so the loader stays fresh within one chat. */
export function loaderForTurn(turn: number): LoaderVariant {
  return loaderVariants[Math.max(0, turn - 1) % loaderVariants.length]!;
}

type WorkingLoaderProps = { variant: LoaderVariant };

/* A small decorative 3D loader; the surrounding status region carries the accessible text. */
export function WorkingLoader({ variant }: WorkingLoaderProps) {
  return (
    <span aria-hidden="true" className="working-loader" data-loader={variant}>
      <LoaderScene variant={variant} />
    </span>
  );
}

function LoaderScene({ variant }: WorkingLoaderProps) {
  switch (variant) {
    case 'cube':
    case 'roll':
      return <View><Box /></View>;
    case 'bounce':
      return (
        <>
          <View><Box /></View>
          <span className="loader-ball" />
        </>
      );
    case 'twist':
    case 'stack':
      return <Plates />;
    case 'burst':
      return <View>{burstOffsets.map((offset) => <Box key={offset.join()} offset={offset} />)}</View>;
    default:
      return never(variant);
  }
}

function View({ children }: { children: ReactNode }) {
  return <span className="loader-view">{children}</span>;
}

const faces = ['front', 'back', 'right', 'left', 'top', 'bottom'] as const;

type Offset = [x: number, y: number, z: number];
type BoxProps = { offset?: Offset };

function Box({ offset }: BoxProps) {
  const style = offset && ({ '--x': offset[0], '--y': offset[1], '--z': offset[2] } as CSSProperties);

  return (
    <span className="loader-box" style={style}>
      {faces.map((face) => (
        <span key={face} className="loader-face" data-face={face} />
      ))}
    </span>
  );
}

/* Eight small cubes that sit together as one larger cube until they burst apart. */
const burstOffsets: Offset[] = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z): Offset => [x, y, z])));

function Plates() {
  return (
    <span className="loader-plates">
      {[0, 1, 2].map((index) => (
        <span key={index} className="loader-plate" data-plate={index} style={{ '--i': index } as CSSProperties} />
      ))}
    </span>
  );
}

function never(value: never): never {
  throw new Error(`Unknown loader: ${String(value)}`);
}
