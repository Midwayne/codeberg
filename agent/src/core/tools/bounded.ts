const BOUNDED = new WeakSet<object>();

/**
 * Mark a result that bounds its own size, such as a subagent job's reports,
 * so output wrappers pass it through instead of spilling it to a preview.
 * The mark follows the object itself, not copies of it.
 */
export function boundedOutput<T extends object>(value: T): T {
  BOUNDED.add(value);

  return value;
}

export function isBoundedOutput(value: unknown): boolean {
  return typeof value === 'object' && value !== null && BOUNDED.has(value);
}
