import { CanvasSettings } from '../canvas/settings';
import { sections } from './settings-styles';

import { ProjectExtensions } from './extensions';
import { LearningSettingsPanel } from './learning-settings';
import { AppearancePanel } from './appearance';
import { ProjectsPanel } from './project-list';
import { cn } from '../lib/utils';

import { type Settings } from './settings';
import { ResourceUsagePanel } from './resource-usage';
import { CleanupPanel } from './cleanup';

export type SettingsNavigationProps = {
  section: 'appearance' | 'projects' | 'mcps' | 'skills' | 'learning' | 'canvas' | 'usage' | 'cleanup';
  setSection: React.Dispatch<
    React.SetStateAction<'appearance' | 'projects' | 'mcps' | 'skills' | 'learning' | 'canvas' | 'usage' | 'cleanup'>
  >;
};

export function SettingsNavigation({ section, setSection }: SettingsNavigationProps) {
  return (
    <nav
      role="tablist"
      aria-label="Settings sections"
      aria-orientation="vertical"
      className="grid grid-cols-2 gap-1 sm:grid-cols-3 border-b border-border pb-3 md:sticky md:top-0 md:grid-cols-1 md:border-b-0 md:pb-0"
    >
      {sections.map(({ id, label, shortLabel, icon: Icon }) => (
        <SettingsTab
          key={id}
          id={id}
          label={label}
          section={section}
          setSection={setSection}
          Icon={Icon}
          shortLabel={shortLabel}
        />
      ))}
    </nav>
  );
}

export type SettingsPanelsProps = Pick<Parameters<typeof Settings>[0], 'onLearningSaved'> & {
  section: 'appearance' | 'projects' | 'mcps' | 'skills' | 'learning' | 'canvas' | 'usage' | 'cleanup';
};

export function SettingsPanels({ section, onLearningSaved }: SettingsPanelsProps) {
  return (
    <div className="min-w-0">
      {sections.map(({ id }) => (
        <div
          key={id}
          role="tabpanel"
          id={`settings-panel-${id}`}
          aria-labelledby={`settings-tab-${id}`}
          hidden={section !== id}
          tabIndex={0}
          className="focus-visible:outline-2 focus-visible:outline-ring"
        >
          {section === id && (
            <>
              {id === 'appearance' && <AppearancePanel />}
              {id === 'projects' && <ProjectsPanel />}
              {id === 'mcps' && <ProjectExtensions kind="mcp" />}
              {id === 'skills' && <ProjectExtensions kind="skill" />}
              {id === 'canvas' && <CanvasSettings />}
              {id === 'learning' && <LearningSettingsPanel onSaved={onLearningSaved} />}
              {id === 'usage' && <ResourceUsagePanel />}
              {id === 'cleanup' && <CleanupPanel />}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export type SettingsTabProps = Pick<Parameters<typeof SettingsNavigation>[0], 'section' | 'setSection'> & {
  id: 'appearance' | 'projects' | 'mcps' | 'skills' | 'learning' | 'canvas' | 'usage' | 'cleanup';
  label: 'Appearance' | 'Projects' | 'MCP servers' | 'Skills' | 'Learning' | 'Canvas' | 'Resource usage' | 'Free up resources';
  Icon: (typeof sections)[number]['icon'];
  shortLabel: 'Appearance' | 'Projects' | 'MCPs' | 'Skills' | 'Learning' | 'Canvas' | 'Usage' | 'Cleanup';
};

export function SettingsTab({ id, label, section, setSection, Icon, shortLabel }: SettingsTabProps) {
  return (
    <button
      key={id}
      type="button"
      role="tab"
      id={`settings-tab-${id}`}
      aria-label={label}
      aria-selected={section === id}
      aria-controls={`settings-panel-${id}`}
      tabIndex={section === id ? 0 : -1}
      onClick={() => setSection(id)}
      onKeyDown={(event) => {
        const index = sections.findIndex((item) => item.id === id);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? sections.length - 1
              : ['ArrowRight', 'ArrowDown'].includes(event.key)
                ? (index + 1) % sections.length
                : ['ArrowLeft', 'ArrowUp'].includes(event.key)
                  ? (index + sections.length - 1) % sections.length
                  : undefined;
        if (next === undefined) return;
        event.preventDefault();
        setSection(sections[next]!.id);
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}
      className={cn(
        'flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 py-3 text-sm md:justify-start md:px-3 focus-visible:outline-2 focus-visible:outline-ring',
        section === id
          ? 'bg-accent font-medium text-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <Icon className="hidden size-4 shrink-0 min-[380px]:block" />
      <span className="md:hidden">{shortLabel}</span>
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}
