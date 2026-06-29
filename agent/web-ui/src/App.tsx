import { useEffect, useState } from "react";

import { Chat } from "@/components/chat";

export function App() {
  // The server exposes the active model/daemon at /api/meta for the title bar.
  const [subtitle, setSubtitle] = useState("");
  useEffect(() => {
    fetch("/api/meta")
      .then((r) => (r.ok ? r.json() : null))
      .then((m: { title?: string } | null) => {
        if (m?.title) setSubtitle(m.title);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3 text-sm">
          <span className="font-semibold">codeberg</span>
          {subtitle && (
            <span className="truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          )}
        </div>
      </header>
      <Chat />
    </div>
  );
}
