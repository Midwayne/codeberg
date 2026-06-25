import { Box, Text, useInput } from "ink";
import { PromptInput } from "./components/prompt-input.js";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { ChatSession } from "../core/session.js";
import { runCommand } from "./commands.js";
import { Transcript } from "./components/transcript.js";
import { loadHistory, pushHistory, saveHistory } from "./history.js";

interface AppProps {
  session: ChatSession;
  modelSpec: string;
  daemonUrl: string;
  initialQuestion?: string;
  onExit: () => void;
}

export function App({
  session,
  modelSpec,
  daemonUrl,
  initialQuestion,
  onExit,
}: AppProps) {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [input, setInput] = useState("");
  // Seed from disk so Up recalls prompts from previous sessions, then keep the
  // file in sync as new prompts are submitted.
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<string | undefined>();
  const ranInitial = useRef(false);

  useEffect(() => session.subscribe(() => refresh()), [session]);

  // Tick an elapsed-time counter while a request is in flight.
  useEffect(() => {
    if (!busy) {
      return;
    }
    const start = Date.now();
    setElapsed(0);
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      250,
    );
    return () => clearInterval(id);
  }, [busy]);

  const submit = useCallback(
    async (line: string) => {
      const trimmed = line.trim();
      if (!trimmed || busy) {
        return;
      }

      const command = runCommand(trimmed, { session, setStatus });
      if (command === "exit") {
        onExit();
        return;
      }
      if (command === "handled") {
        setInput("");
        return;
      }

      setHistory((h) => {
        const next = pushHistory(h, trimmed);
        saveHistory(next);
        return next;
      });
      setBusy(true);
      setStatus(undefined);
      setInput("");

      try {
        await session.ask(trimmed);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [busy, onExit, session],
  );

  useInput((inputKey, key) => {
    if (key.ctrl && inputKey === "c") {
      onExit();
    }
  });

  useEffect(() => {
    if (!initialQuestion || ranInitial.current) {
      return;
    }
    ranInitial.current = true;
    void submit(initialQuestion);
  }, [initialQuestion, submit]);

  return (
    <Box flexDirection="column">
      <Transcript
        history={session.history}
        busy={busy}
        elapsed={elapsed}
        status={status}
      />
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="cyan">{"> "}</Text>
        <PromptInput
          value={input}
          onChange={setInput}
          onSubmit={submit}
          history={history}
          placeholder={busy ? "…" : "ask a question or follow up"}
        />
      </Box>
      <Text dimColor>
        codeberg chat · {modelSpec} · {daemonUrl} — /help · /copy · /clear ·
        /quit · ↑ history · Ctrl+C exit
      </Text>
    </Box>
  );
}
