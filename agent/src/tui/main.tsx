#!/usr/bin/env node
import { render } from "ink";

import { createAgentFromEntry } from "../core/config.js";
import { entryUsage, parseEntryArgs } from "../core/entry.js";
import { ChatSession } from "../core/session.js";
import { App } from "./app.js";

const entry = parseEntryArgs(process.argv);
if (!entry) {
  console.error(entryUsage("codeberg-tui"));
  process.exit(1);
}

const agent = createAgentFromEntry(entry);
const session = new ChatSession({ agent, once: entry.once });

// Turn on bracketed-paste mode ourselves rather than relying on the terminal's
// default (zsh disables it before launching a command). This makes the terminal
// wrap pasted text in ESC[200~ … ESC[201~ so a multi-line paste is captured as
// one unit instead of being treated as several keystrokes. Always restore it.
// ESC is written explicitly (not as a raw control byte in source).
const ESC = "\u001B";
const BRACKETED_PASTE_ON = `${ESC}[?2004h`;
const BRACKETED_PASTE_OFF = `${ESC}[?2004l`;
if (process.stdout.isTTY) {
  process.stdout.write(BRACKETED_PASTE_ON);
  process.on("exit", () => {
    process.stdout.write(BRACKETED_PASTE_OFF);
  });
}

const { waitUntilExit } = render(
  <App
    session={session}
    modelSpec={entry.modelSpec}
    daemonUrl={entry.daemonUrl}
    initialQuestion={entry.question || undefined}
    onExit={() => process.exit(0)}
  />,
);

void waitUntilExit();
