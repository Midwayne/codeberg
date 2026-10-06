import { validChatId } from './context.js';
import { writeModuleLog } from '../module-log.js';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, readData, withCanvasLock } from './storage.js';
import { mutate } from './mutations.js';
import { CanvasError, validName, type Mutation, type Scene } from './types.js';
import { portableAppState, validateScene } from './validation.js';

export class CanvasStore {
  constructor(readonly root: string, readonly url: string, private readonly defaultEnabled = false, readonly chatId?: string) {}

  forChat(chatId: string): CanvasStore {
    validChatId(chatId);
    const url = new URL(this.url, 'http://localhost');
    url.searchParams.set('chat', chatId);
    const scopedUrl = this.url.startsWith('/') ? url.pathname + url.search : url.href;

    return new CanvasStore(this.root, scopedUrl, this.defaultEnabled, chatId);
  }

  async ensure(): Promise<Scene> {
    if (!this.chatId) throw new CanvasError('A chat is required.');

    return this.create(`chat-${this.chatId}`);
  }

  async settings(): Promise<{ enabled: boolean }> {
    const value = await readData(join(this.root, 'settings.json')) as { enabled?: unknown } | undefined;
    if (value && typeof value.enabled !== 'boolean') throw new CanvasError('Invalid canvas settings.', 503);

    return { enabled: value?.enabled as boolean ?? this.defaultEnabled };
  }

  async configure(enabled: boolean): Promise<{ enabled: boolean }> {
    if (typeof enabled !== 'boolean') throw new CanvasError('enabled must be a boolean.');

    return withCanvasLock(this.root, async () => {
      await atomicWrite(join(this.root, 'settings.json'), { enabled });
      return { enabled };
    });
  }

  async available(): Promise<boolean> {
    try {
      return (await this.settings()).enabled;
    } catch (error) {
      writeModuleLog('agent', 'canvas_settings_failed', { error: String(error) });
      return false;
    }
  }

  async requireEnabled(): Promise<void> {
    if (!(await this.settings()).enabled) throw new CanvasError('Canvas is disabled. Enable it in Settings → Canvas.', 403);
  }

  async create(name: string): Promise<Scene> {
    name = this.scopeName(name)!;
    validName(name);
    return withCanvasLock(this.root, async () => {
      await this.requireEnabled();
      if (this.chatId && await readData(this.path(name))) return this.current();

      if (await readData(this.path(name))) throw new CanvasError('Canvas already exists. Use canvas_open.');

      const scene: Scene = { type: 'excalidraw', version: 2, source: 'codeberg', name,
        elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {},
        revision: 0, updatedAt: new Date().toISOString() };
      await atomicWrite(this.path(name), scene);
      if (!this.chatId) await atomicWrite(join(this.root, 'index.json'), { active: name });
      return scene;
    });
  }

  async open(name: string): Promise<Scene> {
    validName(name);
    return withCanvasLock(this.root, async () => {
      const scene = await this.current(name);
      if (!this.chatId) await atomicWrite(join(this.root, 'index.json'), { active: name });
      return scene;
    });
  }

  async current(name?: string): Promise<Scene> {
    await this.requireEnabled();
    name = this.scopeName(name);
    if (!name) {
      const index = await readData(join(this.root, 'index.json')) as { active?: string } | undefined;
      name = index?.active;
    }
    if (!name) throw new CanvasError('No active canvas. Create or open one.', 404);

    validName(name);
    const scene = await readData(this.path(name));
    if (!scene) throw new CanvasError('Canvas not found.', 404);

    validateScene(scene);
    if (scene.name !== name) throw new CanvasError('Canvas filename and scene name disagree.', 503);

    return scene;
  }

  async list() {
    await this.requireEnabled();
    const names = await readdir(this.root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];

      throw error;
    });
    return Promise.all(names.filter((name) => name.endsWith('.excalidraw')).sort().map(async (file) => {
      const scene = await this.current(file.slice(0, -11));
      return { name: scene.name, updatedAt: scene.updatedAt,
        elementCount: scene.elements.filter((element) => !element.isDeleted).length };
    }));
  }

  async change(operation: string, input: Mutation): Promise<Scene> {
    return withCanvasLock(this.root, async () => {
      const scene = await this.current(input.name);
      this.checkRevision(scene, input.revision);
      mutate(scene, operation, input);
      return this.commit(scene);
    });
  }

  async saveBrowser(value: unknown): Promise<Scene> {
    validateScene(value);
    return withCanvasLock(this.root, async () => {
      const scene = await this.current();
      if (value.name !== scene.name) throw new CanvasError('Active canvas changed. Reconnect before saving.', 409);

      this.checkRevision(scene, value.revision);
      const next = structuredClone(value);
      next.appState = portableAppState(next.appState);
      // Browser bindings are authoritative after users reconnect or detach arrows.
      for (const element of next.elements) {
        if (element.type === 'arrow') element.customData = { codeberg: {
          from: element.startBinding?.elementId, to: element.endBinding?.elementId,
        } };
      }
      return this.commit(next);
    });
  }

  describe(scene: Scene, offset = 0, limit = 100) {
    const live = scene.elements.filter((element) => !element.isDeleted);
    const entities = live.filter((element) => !element.containerId);
    return { ...this.summary(scene), total: entities.length,
      elements: entities.slice(offset, offset + limit).map((element) => ({
        id: element.id, type: element.type, x: element.x, y: element.y,
        width: element.width, height: element.height,
        text: (element.text ?? live.find((label) => label.containerId === element.id)?.text)?.slice(0, 2000),
        from: element.startBinding?.elementId, to: element.endBinding?.elementId,
      })) };
  }

  summary(scene: Scene) {
    return { ...(this.chatId ? { kind: 'canvas', chatId: this.chatId } : { name: scene.name }),
      revision: scene.revision, updatedAt: scene.updatedAt,
      path: this.path(scene.name), url: this.url,
      elementCount: scene.elements.filter((element) => !element.isDeleted).length };
  }

  private scopeName(name?: string): string | undefined {
    if (!this.chatId) return name;

    const scoped = `chat-${this.chatId}`;
    if (name && name !== scoped) throw new CanvasError('Canvas belongs to a different chat.', 409);

    return scoped;
  }

  private path(name: string): string {
    validName(name);
    return join(this.root, `${name}.excalidraw`);
  }

  private checkRevision(scene: Scene, revision?: number): void {
    if (revision !== undefined && revision !== scene.revision) {
      throw new CanvasError(`Canvas revision conflict: expected ${revision}, current ${scene.revision}. Read canvas_get and retry.`, 409);
    }
  }

  private async commit(scene: Scene): Promise<Scene> {
    scene.revision++;
    scene.updatedAt = new Date().toISOString();
    validateScene(scene);
    await atomicWrite(this.path(scene.name), scene);
    return scene;
  }
}
