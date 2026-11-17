import { DaemonError } from '../client.js';
import { errorMessage } from '../errors.js';

/** Keep daemon failures in the tool result: SDK-thrown errors become the
 * unhelpful "An error occurred." in some provider transcripts. */
export function daemonToolError(error: unknown): { error: string } {
  if (error instanceof DaemonError) {
    return { error: `${error.code}: ${error.message}` };
  }

  return { error: errorMessage(error) };
}
