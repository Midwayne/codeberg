/** Plain-object guards for parsed JSON/YAML input; arrays and null are not records. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}
