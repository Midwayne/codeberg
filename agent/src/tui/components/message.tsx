import { Box, Text } from "ink";

import { formatSource } from "../../core/format.js";
import type { Turn } from "../../core/types.js";
import { Markdown } from "../markdown.js";

interface MessageProps {
  turn: Turn;
}

/** A single transcript turn: role badge, body, and (for answers) sources. */
export function Message({ turn }: MessageProps) {
  const isUser = turn.role === "user";
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={isUser ? "cyan" : "green"}>
        {isUser ? "▶ you" : "✦ agent"}
      </Text>
      {isUser ? (
        <Text wrap="wrap">{turn.content}</Text>
      ) : (
        <Markdown content={turn.content} />
      )}
      {turn.sources && turn.sources.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>sources</Text>
          {turn.sources.map((s, i) => (
            <Text key={s.id} dimColor>
              {`[${i + 1}] ${formatSource(s)}`}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
