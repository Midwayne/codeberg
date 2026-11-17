type ModelSpec = { provider: string; modelId: string };

/** Split "provider:modelId" at the first colon; undefined when no provider precedes it. */
export function parseModelSpec(spec: string): ModelSpec | undefined {
  const separator = spec.indexOf(':');
  if (separator <= 0) return undefined;

  return { provider: spec.slice(0, separator), modelId: spec.slice(separator + 1) };
}

/** The provider half of a spec, or '' when the spec has none. */
export function specProvider(spec: string | undefined): string {
  return parseModelSpec(spec ?? '')?.provider ?? '';
}
