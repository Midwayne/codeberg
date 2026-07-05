import { homedir } from "node:os";
import { join } from "node:path";

/** Mirrors the launcher's Go `paths.Home`: honour CODEBERG_HOME, else ~/.codeberg. */
export function codebergHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEBERG_HOME ?? join(homedir(), ".codeberg");
}
