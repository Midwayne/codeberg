import { Info } from 'lucide-react';
import { type ReactNode } from 'react';

export function DocsNote({ children }: { children?: ReactNode }) {
  return (
    <aside role="note" className="docs-note">
      <Info aria-hidden="true" className="mt-1 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </aside>
  );
}
