import { isSpillPreview, spillResultCount } from '@agent/core/context/spill-preview.js';

const LABELS: Record<string, string> = {
  file_outline: 'outline hits',
  find_symbol: 'symbol hits',
  glob: 'glob results',
  grep: 'grep matches',
  hybrid_search: 'hybrid results',
  list_dir: 'directory results',
  search_code: 'results',
  search_graph: 'graph hits',
  tree: 'tree results',
};

export { isSpillPreview };

export function spilledToolTitle(name: string, output: unknown): string {
  const count = spillResultCount(output);
  const label = LABELS[name] ?? `${name} results`;
  return count == null ? `Large ${label} (spilled)` : `${count} ${label} (spilled)`;
}
