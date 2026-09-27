/** Conservative, deterministic query-family matching; no external embedding service needed. */
const STOP = new Set('a an the this that it its is are was which where who what why how do does did can please me show find identify locate tell explain ultimately value field code logic service repository repo file function implemented implementation defined of from to in by'.split(' '));
const ALIASES: Record<string, string> = {
  originated: 'origin', originates: 'origin', originating: 'origin', originate: 'origin',
  source: 'origin', sources: 'origin', produced: 'origin', produces: 'origin', producer: 'origin',
  producing: 'origin', comes: 'origin', come: 'origin', generated: 'origin', generates: 'origin',
  consumer: 'consume', consumers: 'consume', consumes: 'consume', consuming: 'consume', subscribed: 'consume',
  caller: 'call', callers: 'call', calls: 'call', calling: 'call',
};

function tokens(query: string): Set<string> {
  const separated = query.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return new Set((separated.match(/[\p{L}\p{N}]+/gu) ?? []).map((word) => ALIASES[word] ?? word)
    .filter((word) => word.length > 1 && !STOP.has(word)));
}

export function similar(a: string, b: string): boolean {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const shared = [...left].filter((word) => right.has(word));
  if (shared.length === left.size && shared.length === right.size) return true;
  return shared.length >= 2 && shared.length / Math.max(left.size, right.size) >= 0.75;
}

export function sameTaskFamily(a: { query: string; files?: string[] }, b: { query: string; files?: string[] }): boolean {
  if (similar(a.query, b.query)) return true;
  const sharedFiles = (a.files ?? []).filter((file) => (b.files ?? []).includes(file));
  const overlap = [...tokens(a.query)].filter((word) => tokens(b.query).has(word));
  return sharedFiles.length > 0 && overlap.length >= 2;
}
