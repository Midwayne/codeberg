import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appendDurable } from '../fs.js';
import type { LearningEvent } from '../types.js';
import type { LearningStoreState } from './state.js';

export async function readEvents(state: LearningStoreState): Promise<LearningEvent[]> {
  let files: string[];
  try {
    files = (await readdir(join(state.root, 'events')))
      .filter((file) => file.endsWith('.jsonl'))
      .sort();
  } catch {
    return [];
  }

  const events: LearningEvent[] = [];
  for (const file of files) {
    const raw = await readFile(join(state.root, 'events', file), 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;

      try {
        events.push(JSON.parse(line) as LearningEvent);
      } catch {
        // A process can die during its final append. Earlier complete lines
        // remain authoritative; a malformed tail is ignored and recoverable.
      }
    }
  }

  return events;
}

export function append(state: LearningStoreState, event: LearningEvent): Promise<void> {
  const date = event.timestamp.slice(0, 10);
  const write = state.writeChain.then(() =>
    appendDurable(join(state.root, 'events', `${date}.jsonl`), event),
  );
  state.writeChain = write.catch(() => undefined);

  return write;
}
