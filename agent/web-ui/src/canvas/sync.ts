import type { Scene } from '@agent/core/canvas/types';
import { mergeScenes, sceneFingerprint } from './merge';

export class CanvasSync {
  base?: Scene;
  local?: Scene;
  latest?: Scene;
  private timer?: ReturnType<typeof setTimeout>;
  private sending = false;
  private stopped = false;
  private blocked = false;

  constructor(private readonly options: {
    fetch: typeof fetch;
    apply: (scene: Scene, animate: boolean) => void;
    status: (message: string) => void;
    conflict: (value: boolean) => void;
  }) {}

  receive(scene: Scene): void {
    if (this.stopped) return;

    if (this.sending || this.blocked) {
      this.latest = scene;
      return;
    }
    if (this.base?.name === scene.name && this.base.revision === scene.revision) return;

    try {
      const next = this.local && this.base ? mergeScenes(this.base, this.local, scene) : scene;
      const animate = Boolean(this.base && sceneFingerprint(this.base) !== sceneFingerprint(scene));
      this.base = scene;
      if (this.local) this.local = next;

      this.options.apply(next, animate);
      this.options.status(this.local ? 'Saving your changes…' : 'Saved');
      if (this.local) this.schedule();
    } catch (error) {
      this.latest = scene;
      this.blocked = true;
      this.options.conflict(true);
      this.options.status(String(error));
    }
  }

  stage(elements: Scene['elements'], appState: Scene['appState'], files: Scene['files']): void {
    if (!this.base || this.stopped) return;

    const next = { ...this.base, elements, appState, files };
    if (sceneFingerprint(next) === sceneFingerprint(this.local ?? this.base)) return;

    this.local = structuredClone(next);
    if (this.blocked) return;

    this.options.status('Saving your changes…');
    this.schedule();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), 300);
  }

  async save(): Promise<void> {
    if (!this.local || !this.base || this.sending || this.blocked || this.stopped) return;

    const sent = { ...this.local, revision: this.base.revision };
    this.sending = true;
    try {
      const response = await this.options.fetch('/api/canvas/scene', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sent),
      });
      if (response.status === 409) throw new Error('The canvas changed while you were editing. Your unsaved edits are kept here.');

      if (!response.ok) throw new Error((await response.json()).error ?? 'Canvas save failed. Retry.');

      const saved = await response.json() as Scene;
      if (sceneFingerprint(this.local) === sceneFingerprint(sent)) this.local = undefined;

      this.base = saved;
      this.options.status('Saved');
    } catch (error) {
      this.blocked = true;
      this.options.conflict(true);
      this.options.status(String(error));
    } finally {
      this.sending = false;
      const latest = this.latest;
      this.latest = undefined;
      if (latest && (!this.base || latest.name !== this.base.name || latest.revision > this.base.revision)) this.receive(latest);

      if (this.local && !this.blocked) this.schedule();
    }
  }

  async reload(): Promise<void> {
    try {
      const response = await this.options.fetch('/api/canvas/scene');
      if (!response.ok) throw new Error((await response.json()).error);

      this.local = undefined;
      this.base = undefined;
      this.blocked = false;
      this.options.conflict(false);
      this.receive(await response.json());
    } catch (error) {
      this.options.status(String(error));
    }
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }
}
