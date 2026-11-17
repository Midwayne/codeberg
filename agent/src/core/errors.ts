/** Display text for a caught value: an Error's message, else `fallback` or its string form. */
export function errorMessage(error: unknown, fallback?: string): string {
  if (error instanceof Error) return error.message;

  return fallback ?? String(error);
}
