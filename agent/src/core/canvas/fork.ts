import { join } from 'node:path';
import { CanvasStore } from './store.js';
import { atomicWrite, readData, withCanvasLock } from './storage.js';
import { validateScene } from './validation.js';
import { writeModuleLog } from '../module-log.js';

/** Copy once when a conversation branches; subsequent edits stay independent. */
export async function forkChatCanvas(store: CanvasStore | undefined, id: string, parentId?: string): Promise<void> {
  if (!store || !parentId) return;

  try {
    store.forChat(id);
    store.forChat(parentId);
    await withCanvasLock(store.root, async () => {
      const target = join(store.root, `chat-${id}.excalidraw`);
      if (await readData(target)) return;

      const parent = await readData(join(store.root, `chat-${parentId}.excalidraw`));
      if (!parent) return;

      validateScene(parent);
      await atomicWrite(target, { ...parent, name: `chat-${id}`, revision: 0, updatedAt: new Date().toISOString() });
    });
  } catch (error) {
    // A canvas disk failure must not prevent saving the conversation itself.
    writeModuleLog('agent', 'canvas_branch_failed', { error: String(error) });
  }
}
