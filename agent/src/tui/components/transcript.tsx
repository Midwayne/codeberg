import { Box, Static, Text } from "ink";
import Spinner from "ink-spinner";

import type { Turn } from "../../core/types.js";
import { Message } from "./message.js";

interface TranscriptProps {
  history: readonly Turn[];
  busy: boolean;
  elapsed: number;
  status?: string;
}

export function Transcript({ history, busy, elapsed, status }: TranscriptProps) {
  return (
    <>
      {/* Completed turns flush to scrollback once and never re-render. */}
      <Static items={[...history]}>
        {(turn, index) => <Message key={index} turn={turn} />}
      </Static>

      {busy && (
        <Box marginBottom={1}>
          <Text color="yellow">
            <Spinner type="dots" />
          </Text>
          <Text dimColor>{` thinking… ${elapsed}s`}</Text>
        </Box>
      )}

      {!busy && status && <Text color="yellow">{status}</Text>}
    </>
  );
}
