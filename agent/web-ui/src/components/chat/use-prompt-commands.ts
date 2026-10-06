import { type usePromptInput } from './use-prompt-input';

import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';

import { commandQuery, matchCommands, type PromptCommand } from '../../lib/commands';
import { useCommands } from '../../lib/use-commands';

import { isComposingKey } from '../../lib/prompt-keyboard';
import { MAX_HEIGHT } from '../../lib/prompt-files';

export type PromptCommandsOptions = Pick<Parameters<typeof usePromptInput>[0], 'inputRef' | 'value'>;

export function usePromptCommands({ inputRef, value }: PromptCommandsOptions) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? fallbackRef;
  const fileRef = useRef<HTMLInputElement>(null);
  const helpId = useId();
  const commandId = useId();

  const commands = useCommands();
  const query = commandQuery(value);
  const matches = useMemo(() => (query === null ? [] : matchCommands(commands, query)), [commands, query]);
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

  return { fileRef, setDismissed, ref, menuOpen, setActiveIndex, matches, activeIndex, commandId, commands, helpId };
}

export type PromptKeyboardOptions = { setValue: Parameters<typeof usePromptInput>[0]['onValueChange'] } & {
  setDismissed: React.Dispatch<React.SetStateAction<boolean>>;
  ref: RefObject<HTMLTextAreaElement | null>;
  menuOpen: boolean;
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  matches: PromptCommand[];
  activeIndex: number;
  submit: () => void;
};

export function usePromptKeyboard({
  setValue,
  setDismissed,
  ref,
  menuOpen,
  setActiveIndex,
  matches,
  activeIndex,
  submit,
}: PromptKeyboardOptions) {
  const { accept } = createCommandAcceptance({ setValue, setDismissed, ref });

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (isComposingKey(e.nativeEvent)) return;
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
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        const command = matches[Math.min(activeIndex, matches.length - 1)];
        if (command) accept(command);
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

  return { accept, onKeyDown };
}

export type CommandAcceptanceOptions = Pick<
  Parameters<typeof usePromptKeyboard>[0],
  'setValue' | 'setDismissed' | 'ref'
>;

export function createCommandAcceptance({ setValue, setDismissed, ref }: CommandAcceptanceOptions) {
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

  return { accept };
}
