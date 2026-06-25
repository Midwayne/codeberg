import { spawn } from "node:child_process";

import type { ChatSession } from "../core/session.js";

export type CommandResult = "continue" | "exit" | "handled";

export interface CommandContext {
  session: ChatSession;
  setStatus: (status: string | undefined) => void;
}

/** Best-effort copy to the system clipboard (pbcopy / clip / xclip). */
function copyToClipboard(text: string): void {
  const command =
    process.platform === "darwin"
      ? "pbcopy"
      : process.platform === "win32"
        ? "clip"
        : "xclip";
  const args =
    process.platform === "linux" ? ["-selection", "clipboard"] : [];
  try {
    const child = spawn(command, args, {
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", () => {
      /* clipboard tool unavailable */
    });
    child.stdin.end(text);
  } catch {
    /* ignore */
  }
}

const COMMANDS: Record<string, (ctx: CommandContext) => CommandResult> = {
  "/quit": () => "exit",
  "/exit": () => "exit",
  "/clear": ({ session, setStatus }) => {
    session.clear();
    setStatus(undefined);
    return "handled";
  },
  "/copy": ({ session, setStatus }) => {
    const last = [...session.history]
      .reverse()
      .find((turn) => turn.role === "assistant");
    if (!last) {
      setStatus("nothing to copy yet");
      return "handled";
    }
    copyToClipboard(last.content);
    setStatus("copied the last answer to the clipboard");
    return "handled";
  },
  "/help": ({ setStatus }) => {
    setStatus(
      "commands: /clear /copy /quit · ↑/↓ recall prompts · Esc clears the line",
    );
    return "handled";
  },
};

export function runCommand(line: string, ctx: CommandContext): CommandResult {
  const handler = COMMANDS[line];
  return handler ? handler(ctx) : "continue";
}
