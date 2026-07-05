import { useEffect, useState } from 'react';

import { listCommands, type PromptCommand } from '@/lib/commands';

/** Loads the server's slash-command catalog once for the composer autocomplete. */
export function useCommands(): PromptCommand[] {
  const [commands, setCommands] = useState<PromptCommand[]>([]);
  useEffect(() => {
    void listCommands().then(setCommands);
  }, []);
  return commands;
}
