import type { BackdropLayer } from './theme-types';

type LayerSpec = Pick<BackdropLayer, 'kind' | 'color'> & Partial<BackdropLayer>;

/** A built-in backdrop layer with the same defaults generated layers get. */
export function layer(spec: LayerSpec): BackdropLayer {
  return { opacity: 0.15, x: 50, y: 30, size: 50, angle: 0, animation: 'none', duration: 30, ...spec };
}
