/** Move `key` to the most-recently-used end of an insertion-ordered map. */
export function touch<K, V>(map: Map<K, V>, key: K, value: V): V {
  map.delete(key);
  map.set(key, value);

  return value;
}

/**
 * Drop entries oldest first until `map` holds at most `capacity`. Entries
 * `canEvict` rejects are kept, so the map may stay over capacity. Returns the
 * evicted entries so callers can release them.
 */
export function evictOldest<K, V>(map: Map<K, V>, capacity: number, canEvict: (value: V, key: K) => boolean = () => true): Array<[K, V]> {
  const evicted: Array<[K, V]> = [];

  for (const [key, value] of map) {
    if (map.size <= capacity) break;

    if (!canEvict(value, key)) continue;

    map.delete(key);
    evicted.push([key, value]);
  }

  return evicted;
}
