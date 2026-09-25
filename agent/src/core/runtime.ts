/** The agent uses ai-sdk v7's timed tool loop, which merges abort signals via
 * AbortSignal.any. Fail at startup rather than after the user's first message. */
export function assertAgentRuntime(
  version: string = process.versions.node,
  abortSignalAny: unknown = typeof AbortSignal === 'undefined' ? undefined : AbortSignal.any,
): void {
  const major = Number(version.split('.')[0]);
  if (!Number.isInteger(major) || major < 22) {
    throw new Error(
      `Codeberg requires Node.js 22 or newer (found ${version}). Upgrade Node.js and check node --version on PATH.`,
    );
  }
  if (typeof abortSignalAny !== 'function') {
    throw new Error(
      `AbortSignal.any is unavailable in Node.js ${version}; Codeberg requires a standard Node.js 22+ runtime.`,
    );
  }
}
