import { type CleanupPanelView } from './cleanup';
import { OpenConfigDirectory } from './config-directory';
import { SettingsNavigation, SettingsPanels } from './settings-navigation';
import { type sections, buttonClass } from './settings-styles';

import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type SettingsProps = { onClose: () => void; onLearningSaved?: () => void };

export function Settings({ onClose, onLearningSaved }: SettingsProps) {
  const [section, setSection] = useState<(typeof sections)[number]['id']>('appearance');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-8 p-4 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              aria-label="Back to chats"
              className={`${buttonClass} flex items-center gap-2`}
            >
              <ArrowLeft className="size-4" />
              <span className="hidden sm:inline">Back to chats</span>
            </button>
            <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
              Settings
            </h1>
          </div>
          <OpenConfigDirectory />
        </div>
        <div className="grid items-start gap-6 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-10">
          <SettingsNavigation section={section} setSection={setSection} />
          <SettingsPanels section={section} onLearningSaved={onLearningSaved} />
        </div>
      </div>
    </main>
  );
}

export type CleanupPreviewErrorProps = { state: Parameters<typeof CleanupPanelView>[0] };

export { ResourceUsageView } from './resource-usage';

export { CleanupOptions } from './cleanup-options';
