import { Brain, RefreshCw, Wrench } from "lucide-react";
import type { UIMessage } from "ai";
import { Streamdown } from "streamdown";

import { Response } from "@/components/response";
import { SearchResults } from "@/components/sources";
import { Badge, Collapsible, CopyButton, IconButton } from "@/components/ui";
import { cn } from "@/lib/utils";

type AnyPart = UIMessage["parts"][number];

/** Loose view over the tool-part union (`tool-<name>` and `dynamic-tool`). */
export interface ToolView {
  type: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

export function Message({
  message,
  onRegenerate,
}: {
  message: UIMessage;
  onRegenerate?: () => void;
}) {
  const isUser = message.role === "user";
  return (
    <div
      className={cn(
        "group/message flex flex-col gap-1",
        isUser ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "min-w-0 max-w-full",
          isUser
            ? "rounded-2xl bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap"
            : "w-full space-y-2",
        )}
      >
        {isUser
          ? userText(message)
          : message.parts.map((part, i) => <Part key={i} part={part} />)}
      </div>
      {!isUser && message.parts.length > 0 && (
        <MessageActions message={message} onRegenerate={onRegenerate} />
      )}
    </div>
  );
}

function Part({ part }: { part: AnyPart }) {
  if (part.type === "text") {
    return part.text ? <Response>{part.text}</Response> : null;
  }
  if (part.type === "reasoning") {
    return <Reasoning text={part.text} />;
  }
  if (part.type === "tool-search_code") {
    return <SearchResults part={part as unknown as ToolView} />;
  }
  if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
    return <ToolCard part={part as unknown as ToolView} />;
  }
  return null;
}

function Reasoning({ text }: { text: string }) {
  if (!text?.trim()) return null;
  return (
    <Collapsible icon={<Brain className="size-3.5" />} title="Reasoning">
      <Streamdown className="space-y-2 text-xs leading-relaxed text-muted-foreground">
        {text}
      </Streamdown>
    </Collapsible>
  );
}

function ToolCard({ part }: { part: ToolView }) {
  const name =
    part.type === "dynamic-tool"
      ? (part.toolName ?? "tool")
      : part.type.slice("tool-".length);
  return (
    <Collapsible
      icon={<Wrench className="size-3.5" />}
      title={<span className="font-mono">{name}</span>}
      badge={<StateBadge state={part.state} />}
    >
      <div className="space-y-2">
        {part.input !== undefined && <Json label="input" value={part.input} />}
        {part.output !== undefined && (
          <Json label="output" value={part.output} />
        )}
        {part.errorText && (
          <div className="text-xs text-destructive">{part.errorText}</div>
        )}
      </div>
    </Collapsible>
  );
}

function StateBadge({ state }: { state?: string }) {
  if (!state) return null;
  const done = state === "output-available";
  const failed = state === "output-error";
  return (
    <Badge
      className={cn(
        done && "bg-emerald-500/15 text-emerald-500",
        failed && "bg-destructive/15 text-destructive",
        !done && !failed && "bg-muted text-muted-foreground",
      )}
    >
      {state.replace("output-", "").replace("input-", "")}
    </Badge>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <pre className="overflow-x-auto rounded-md bg-background p-2 font-mono text-xs text-foreground/80">
        {text}
      </pre>
    </div>
  );
}

function MessageActions({
  message,
  onRegenerate,
}: {
  message: UIMessage;
  onRegenerate?: () => void;
}) {
  const text = message.parts
    .filter((p): p is Extract<AnyPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n\n");
  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
      {text && <CopyButton text={text} />}
      {onRegenerate && (
        <IconButton onClick={onRegenerate} aria-label="Regenerate" title="Regenerate">
          <RefreshCw className="size-3.5" />
        </IconButton>
      )}
    </div>
  );
}

function userText(message: UIMessage) {
  return message.parts
    .filter((p): p is Extract<AnyPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}
