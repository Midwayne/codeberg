import { CornerDownLeft } from 'lucide-react';

import type { PromptCommand } from '@/lib/commands';
import { cn } from '@/lib/utils';

/**
 * Slash-command autocomplete shown above the composer. Presentational: the
 * parent (`PromptInput`) owns the filtered list, the active index, and all key
 * handling, so this just renders rows + a detail area for the active command.
 * Hovering a row makes it active (so the detail text updates), matching how
 * agent harnesses preview what a command does before you accept it.
 */
export function CommandMenu({
  commands,
  activeIndex,
  onActivate,
  onSelect,
}: {
  commands: PromptCommand[];
  activeIndex: number;
  onActivate: (index: number) => void;
  onSelect: (command: PromptCommand) => void;
}) {
  if (commands.length === 0) return null;
  const active = commands[Math.min(activeIndex, commands.length - 1)];

  return (
    <div
      role="listbox"
      aria-label="Slash commands"
      className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
    >
      <ul className="max-h-64 overflow-y-auto py-1">
        {commands.map((command, index) => {
          const selected = index === activeIndex;
          return (
            <li key={command.trigger}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                title={command.description}
                onMouseEnter={() => onActivate(index)}
                // mousedown (not click) so we act before the textarea blurs.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(command);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                  selected ? 'bg-accent' : 'hover:bg-accent/60',
                )}
              >
                <span className="font-mono text-foreground">{command.trigger}</span>
                {command.argHint && (
                  <span className="font-mono text-xs text-muted-foreground">{command.argHint}</span>
                )}
                <span className="ml-auto truncate pl-3 text-xs text-muted-foreground">
                  {command.summary}
                </span>
                {selected && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />}
              </button>
            </li>
          );
        })}
      </ul>

      {active && (
        <div className="border-t border-border bg-card/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">{active.title}</span> — {active.description}
        </div>
      )}
    </div>
  );
}
