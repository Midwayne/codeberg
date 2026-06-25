import { Text, useInput } from "ink";
import { useEffect, useRef, useState } from "react";

// Bracketed-paste markers the terminal wraps pasted text in. Ink strips the
// leading ESC while parsing, so they reach us as plain "[200~" / "[201~".
const PASTE_START = "[200~";
const PASTE_END = "[201~";

/**
 * Clean a pasted chunk for a single-line input: drop bracketed-paste markers,
 * flatten newlines/tabs to spaces (so a multi-line paste does not submit or
 * wrap), and strip any remaining control characters.
 */
export function sanitizePaste(input: string): string {
  const stripped = input.replaceAll(PASTE_START, "").replaceAll(PASTE_END, "");
  let out = "";
  for (const ch of stripped) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\n" || ch === "\r" || ch === "\t") {
      out += " ";
    } else if (code < 0x20 || code === 0x7f) {
      // drop other control characters
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Drive the bracketed-paste state machine. A paste can arrive across several
 * input events: the `[200~` start marker, one or more body chunks, then the
 * `[201~` end marker. Accumulate the body in `buffer` until the end marker so
 * embedded newlines or a stray Enter never submit or split the line.
 *
 * @param buffer collected body so far, or null when not inside a paste
 * @returns the next buffer (null once complete) and, when finished, the
 *   sanitized text ready to insert
 */
export function feedPaste(
  buffer: string | null,
  input: string,
): { buffer: string | null; complete: string | null } {
  let chunk = input;
  if (buffer === null) {
    const start = input.indexOf(PASTE_START);
    if (start === -1) {
      return { buffer: null, complete: null };
    }
    buffer = "";
    chunk = input.slice(start + PASTE_START.length);
  }
  const end = chunk.indexOf(PASTE_END);
  if (end === -1) {
    return { buffer: buffer + chunk, complete: null };
  }
  return {
    buffer: null,
    complete: sanitizePaste(buffer + chunk.slice(0, end)),
  };
}

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  /** Previously submitted prompts, oldest first; Up/Down navigate them. */
  history: readonly string[];
  placeholder?: string;
  isActive?: boolean;
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  history,
  placeholder = "",
  isActive = true,
}: PromptInputProps) {
  const [cursor, setCursor] = useState(value.length);
  // null = editing a live draft; otherwise an index into `history`.
  const [navIndex, setNavIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  // Body collected mid-paste, or null when not inside a bracketed paste. A ref
  // because a paste spans several input events and must persist between them
  // without forcing a re-render.
  const pasteBuffer = useRef<string | null>(null);

  // Keep the cursor in bounds when the value changes from outside (e.g.
  // cleared on submit).
  useEffect(() => {
    setCursor((c) => Math.min(c, value.length));
  }, [value]);

  useInput(
    (input, key) => {
      // Bracketed paste: swallow every event from the `[200~` start marker
      // through the `[201~` end marker, then insert the whole thing at once.
      // This runs first so a newline or Enter inside the paste is treated as
      // text, never as a submit.
      if (pasteBuffer.current !== null || input.includes(PASTE_START)) {
        const { buffer, complete } = feedPaste(pasteBuffer.current, input);
        pasteBuffer.current = buffer;
        if (complete) {
          onChange(value.slice(0, cursor) + complete + value.slice(cursor));
          setCursor(cursor + complete.length);
          setNavIndex(null);
        }
        return;
      }

      // History navigation.
      if (key.upArrow) {
        if (history.length === 0) {
          return;
        }
        if (navIndex === null) {
          setDraft(value);
        }
        const next =
          navIndex === null ? history.length - 1 : Math.max(0, navIndex - 1);
        setNavIndex(next);
        const recalled = history[next] ?? "";
        onChange(recalled);
        setCursor(recalled.length);
        return;
      }
      if (key.downArrow) {
        if (navIndex === null) {
          return;
        }
        const next = navIndex + 1;
        if (next >= history.length) {
          setNavIndex(null);
          onChange(draft);
          setCursor(draft.length);
        } else {
          setNavIndex(next);
          const recalled = history[next] ?? "";
          onChange(recalled);
          setCursor(recalled.length);
        }
        return;
      }

      // A lone Enter submits. Pasted newlines never reach here — they are
      // swallowed by the bracketed-paste handler above.
      if (key.return) {
        onSubmit(value);
        setNavIndex(null);
        setDraft("");
        return;
      }

      // Esc clears the line rather than quitting the app.
      if (key.escape) {
        onChange("");
        setCursor(0);
        setNavIndex(null);
        return;
      }

      if (key.leftArrow) {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.rightArrow) {
        setCursor((c) => Math.min(value.length, c + 1));
        return;
      }

      if (key.backspace || key.delete) {
        if (cursor > 0) {
          onChange(value.slice(0, cursor - 1) + value.slice(cursor));
          setCursor(cursor - 1);
          setNavIndex(null);
        }
        return;
      }

      // Ignore control/meta combos (Ctrl+C exit etc. handled elsewhere).
      if (key.ctrl || key.meta || key.tab) {
        return;
      }

      // Normal typing, or a paste from a terminal that did not send bracketed
      // markers. Anything longer than one char (or containing newlines) is
      // treated as a paste and sanitized so it cannot submit or wrap.
      const isPaste = input.length > 1 || /[\r\n]/.test(input);
      const text = isPaste ? sanitizePaste(input) : input;
      if (!text) {
        return;
      }
      onChange(value.slice(0, cursor) + text + value.slice(cursor));
      setCursor(cursor + text.length);
      setNavIndex(null);
    },
    { isActive },
  );

  if (value.length === 0) {
    return (
      <Text>
        <Text inverse>{placeholder.slice(0, 1) || " "}</Text>
        <Text dimColor>{placeholder.slice(1)}</Text>
      </Text>
    );
  }

  const safeCursor = Math.min(cursor, value.length);
  return (
    <Text>
      {value.slice(0, safeCursor)}
      <Text inverse>{value.slice(safeCursor, safeCursor + 1) || " "}</Text>
      {value.slice(safeCursor + 1)}
    </Text>
  );
}
