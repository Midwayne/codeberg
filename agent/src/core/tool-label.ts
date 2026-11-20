/** Input fields that best describe a tool call, in the order they are tried. */
const LABEL_FIELDS = ['query', 'pattern', 'name', 'symbol', 'path', 'url'] as const;

/** The most descriptive string argument of a tool call, e.g. its query or path; '' when none. */
export function toolInputLabel(input: unknown): string {
  if (!input || typeof input !== 'object') return '';

  const args = input as Record<string, unknown>;
  const value = LABEL_FIELDS.map((key) => args[key])
    .find((field): field is string => typeof field === 'string' && field.trim() !== '');

  return value ?? '';
}
