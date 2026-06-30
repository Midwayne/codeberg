#!/usr/bin/env node
import { createAgentFromEntry } from "../core/config.js";
import { entryUsage, parseEntryArgs } from "../core/entry.js";
import { ChatSession } from "../core/session.js";
import { printResult } from "./format.js";

async function main(): Promise<void> {
  const entry = parseEntryArgs(process.argv);
  if (!entry?.question) {
    console.error(entryUsage("codeberg-ask"));
    process.exit(1);
  }

  const session = new ChatSession({ agent: createAgentFromEntry(entry) });
  const result = await session.ask(entry.question);
  printResult(result);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
