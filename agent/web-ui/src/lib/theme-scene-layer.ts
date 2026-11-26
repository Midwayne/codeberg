import { LAYER_DEFAULTS } from './backdrop-normalize';
import type { BackdropLayer } from './theme-types';

type LayerSpec = Pick<BackdropLayer, 'kind' | 'color'> & Partial<BackdropLayer>;

/** A built-in backdrop layer with the same defaults generated layers get. */
export function layer(spec: LayerSpec): BackdropLayer {
  return { ...LAYER_DEFAULTS, ...spec };
}
