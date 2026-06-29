import { Streamdown } from "streamdown";

import { cn } from "@/lib/utils";

/**
 * Streaming-aware markdown. Streamdown (the engine behind ai-elements'
 * `<Response>`) tolerates incomplete markdown mid-stream and highlights code
 * via shiki, so partial tokens never flicker as broken syntax.
 */
export function Response({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <Streamdown
      className={cn(
        "space-y-3 text-sm leading-relaxed break-words",
        "[&_pre]:my-0 [&_code]:text-[0.85em]",
        className,
      )}
    >
      {children}
    </Streamdown>
  );
}
