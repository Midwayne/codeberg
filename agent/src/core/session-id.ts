/**
 * Session (chat) ids double as filenames and arrive from the client, so constrain
 * them to a safe charset — this is the guard against path traversal on the by-id
 * routes (a `../` id can never reach `join`).
 */
export function isValidSessionId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}
