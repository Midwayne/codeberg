import { highlight } from "cli-highlight";
import { Box, Text } from "ink";
import { marked, type Token, type Tokens } from "marked";
import type { ReactNode } from "react";

// Citation tokens like [path/to/file.ts:12-34] or [pkg/file.go:L7]. A
// non-global copy is used for testing (no lastIndex state); the global copy
// drives the capturing split so the delimiters are kept.
const CITATION = /\[[^\]\s]+:L?\d+(?:-\d+)?\]/;
const CITATION_SPLIT = new RegExp(`(${CITATION.source})`, "g");

interface MarkdownProps {
  content: string;
}

/** Renders an agent answer (markdown) using Ink primitives. */
export function Markdown({ content }: MarkdownProps) {
  const tokens = marked.lexer(content.trim());
  return (
    <Box flexDirection="column">
      {tokens.map((token, i) => (
        <Block key={i} token={token} />
      ))}
    </Box>
  );
}

function Block({ token }: { token: Token }): ReactNode {
  switch (token.type) {
    case "heading":
      return (
        <Box marginTop={1}>
          <Text bold color="cyan">
            {"#".repeat(token.depth)} {renderInline(token.tokens)}
          </Text>
        </Box>
      );

    case "paragraph":
      return <Text wrap="wrap">{renderInline(token.tokens)}</Text>;

    case "code":
      return <CodeBlock code={token.text} lang={token.lang} />;

    case "blockquote": {
      const quote = token as Tokens.Blockquote;
      return (
        <Box flexDirection="row">
          <Text dimColor>{"│ "}</Text>
          <Box flexDirection="column">
            {quote.tokens.map((child, i) => (
              <Block key={i} token={child} />
            ))}
          </Box>
        </Box>
      );
    }

    case "list": {
      const list = token as Tokens.List;
      return (
        <Box flexDirection="column">
          {list.items.map((item, i) => {
            const marker = list.ordered
              ? `${(typeof list.start === "number" ? list.start : 1) + i}. `
              : "• ";
            return (
              <Box key={i} flexDirection="row">
                <Text>{marker}</Text>
                <Box flexDirection="column">
                  <Text wrap="wrap">{renderInline(item.tokens)}</Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      );
    }

    case "hr":
      return <Text dimColor>{"─".repeat(40)}</Text>;

    case "space":
      return null;

    default:
      return "text" in token && token.text ? (
        <Text wrap="wrap">{token.text}</Text>
      ) : null;
  }
}

function CodeBlock({ code, lang }: { code: string; lang?: string }): ReactNode {
  let rendered = code;
  try {
    rendered = highlight(code, { language: lang || undefined, ignoreIllegals: true });
  } catch {
    rendered = code;
  }
  return (
    <Box
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      flexDirection="column"
    >
      <Text>{rendered.replace(/\n$/, "")}</Text>
    </Box>
  );
}

function renderInline(tokens?: Token[]): ReactNode {
  if (!tokens) {
    return null;
  }
  return tokens.map((token, i) => <Inline key={i} token={token} />);
}

function Inline({ token }: { token: Token }): ReactNode {
  switch (token.type) {
    case "text":
      return token.tokens?.length ? (
        <>{renderInline(token.tokens)}</>
      ) : (
        <PlainText text={token.text} />
      );

    case "escape":
      return <PlainText text={token.text} />;

    case "paragraph":
      return <>{renderInline(token.tokens)}</>;

    case "strong":
      return <Text bold>{renderInline(token.tokens)}</Text>;

    case "em":
      return <Text italic>{renderInline(token.tokens)}</Text>;

    case "del":
      return <Text strikethrough>{renderInline(token.tokens)}</Text>;

    case "codespan":
      return <Text color="yellow">{token.text}</Text>;

    case "link":
      return (
        <Text color="blue" underline>
          {renderInline(token.tokens)}
        </Text>
      );

    case "br":
      return <Text>{"\n"}</Text>;

    default:
      return "text" in token ? <PlainText text={token.text} /> : null;
  }
}

/** Plain text with `[path:lines]` citations highlighted. */
function PlainText({ text }: { text: string }): ReactNode {
  const parts = text.split(CITATION_SPLIT);
  return parts.map((part, i) =>
    CITATION.test(part) ? (
      <Text key={i} color="magenta">
        {part}
      </Text>
    ) : (
      <Text key={i}>{part}</Text>
    ),
  );
}
