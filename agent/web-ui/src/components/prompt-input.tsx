import { ArrowUp, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CommandMenu } from '@/components/command-menu';
import { commandQuery, matchCommands, type PromptCommand } from '@/lib/commands';
import { useCommands } from '@/lib/use-commands';
import { cn } from '@/lib/utils';

const MAX_HEIGHT = 200;

/**
 * Auto-growing composer. Enter sends, Shift+Enter inserts a newline. The action
 * button becomes a stop control while a turn is streaming.
 *
 * Typing a leading slash opens a command autocomplete (driven by the server's
 * `/api/commands` catalog): ↑/↓ to move, Enter/Tab to accept, Esc to dismiss,
 * hover to preview what a command does. Accepting inserts the trigger so the
 * user can finish the prompt — the command itself is enhanced server-side.
 */
export function PromptInput({
  busy,
  onSend,
  onStop,
}: {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [value, setValue] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const commands = useCommands();
  const query = commandQuery(value);
  const matches = useMemo(
    () => (query === null ? [] : matchCommands(commands, query)),
    [commands, query],
  );
  const menuOpen = !dismissed && matches.length > 0;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  // Reset the highlight whenever the set of matches changes (new query).
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function submit() {
    const text = value.trim();
    if (!text || busy) return;
    onSend(text);
    setValue('');
    setDismissed(false);
  }

  function accept(command: PromptCommand) {
    const next = `${command.trigger} `;
    setValue(next);
    setDismissed(true);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.length, next.length);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (menuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        accept(matches[Math.min(activeIndex, matches.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="relative flex items-end gap-2 rounded-2xl border border-input bg-card p-2 shadow-sm transition-colors focus-within:border-ring">
      {menuOpen && (
        <CommandMenu
          commands={matches}
          activeIndex={activeIndex}
          onActivate={setActiveIndex}
          onSelect={accept}
        />
      )}
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setDismissed(false);
        }}
        onKeyDown={onKeyDown}
        placeholder="Ask about the codebase…  (type / for commands)"
        className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
      />
      {busy ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop"
          title="Stop"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Square className="size-3.5 fill-current" />
        </button>
      ) : (
        <button
          type="button"
          onClick={submit}
          disabled={!value.trim()}
          aria-label="Send"
          title="Send"
          className={cn(
            'inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity',
            'hover:opacity-90 disabled:opacity-30',
          )}
        >
          <ArrowUp className="size-4" />
        </button>
      )}
    </div>
  );
}
