import { lazy, Suspense } from "react";

import { cn } from "@/lib/utils";

// Streamdown pulls in shiki + mermaid (the bulk of the bundle). Load it lazily
// so the initial app shell stays small; until the chunk arrives, show the raw
// text (readable, no flicker to blank). After the first load it renders inline.
const Streamdown = lazy(() =>
  import("streamdown").then((m) => ({ default: m.Streamdown })),
);

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
    <Suspense
      fallback={
        <div
          className={cn(
            "space-y-3 text-sm leading-relaxed break-words whitespace-pre-wrap",
            className,
          )}
        >
          {children}
        </div>
      }
    >
      <Streamdown
        className={cn(
          "space-y-3 text-sm leading-relaxed break-words",
          "[&_pre]:my-0 [&_code]:text-[0.85em]",
          className,
        )}
      >
        {children}
      </Streamdown>
    </Suspense>
  );
}
