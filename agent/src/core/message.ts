import type { ModelMessage } from "ai";

/**
 * The readable text of a model message: string content as-is, or the
 * concatenated text parts, ignoring tool-call/tool-result parts. The single
 * definition shared by the agent's history budgeter, the TUI command parser,
 * and session titling — so handling a new content-part type is a one-line edit.
 */
export function messageText(message: ModelMessage): string {
  const { content } = message;
  if (typeof content === "string") {
    return content;
  }
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}
