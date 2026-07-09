/** Build a short session title from free-form text. */
export function titleFromText(text: string, empty = 'New chat'): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) {
    return empty;
  }
  return clean.length > 60 ? `${clean.slice(0, 59)}…` : clean;
}
