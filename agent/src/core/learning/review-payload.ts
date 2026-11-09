/** `answer` → `chosen` → last trajectory step — shared with the review UI. */
export function answerFromPayload(payload: Record<string, unknown>): string {
  if (typeof payload.answer === 'string') return payload.answer;

  if (typeof payload.chosen === 'string') return payload.chosen;

  const trajectory = payload.successful_trajectory ?? payload.trajectory;

  return Array.isArray(trajectory) ? String(trajectory.at(-1)?.answer ?? '') : '';
}

/** Non-empty string paths from a verifier `proposed_files` array. */
export function verifierProposedFiles(verifier: unknown): string[] {
  if (!verifier || typeof verifier !== 'object' || !('proposed_files' in verifier)) return [];

  const files = (verifier as { proposed_files?: unknown }).proposed_files;

  return Array.isArray(files)
    ? files.filter((path): path is string => typeof path === 'string')
    : [];
}
