/** Crossfade rendered pixels without delaying or changing the authoritative scene. */
export class SceneFade {
  private snapshot?: HTMLCanvasElement;
  private animation?: Animation;
  private frame = 0;

  constructor(private readonly surface: () => HTMLElement | null) {}

  capture(): void {
    if (document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const source = this.surface()?.querySelector<HTMLCanvasElement>('canvas.excalidraw__canvas.static');
    if (!source?.width || !source.height || !source.parentElement) return;

    const snapshot = document.createElement('canvas');
    snapshot.width = source.width;
    snapshot.height = source.height;
    const context = snapshot.getContext('2d');
    if (!context) return;

    context.drawImage(source, 0, 0);
    if (this.snapshot) {
      context.globalAlpha = Number(getComputedStyle(this.snapshot).opacity);
      context.drawImage(this.snapshot, 0, 0, snapshot.width, snapshot.height);
    }
    this.cancel();

    snapshot.className = 'canvas-scene-snapshot';
    snapshot.style.width = source.style.width;
    snapshot.style.height = source.style.height;
    snapshot.setAttribute('aria-hidden', 'true');
    source.parentElement.append(snapshot);
    this.snapshot = snapshot;

    // Excalidraw batches rendering; wait for its updated pixels before revealing them.
    this.frame = requestAnimationFrame(() => {
      this.frame = requestAnimationFrame(() => this.reveal(snapshot));
    });
  }

  cancel(): void {
    cancelAnimationFrame(this.frame);
    this.animation?.cancel();
    this.snapshot?.remove();
    this.snapshot = undefined;
    this.animation = undefined;
  }

  private reveal(snapshot: HTMLCanvasElement): void {
    if (!snapshot.animate) {
      this.cancel();
      return;
    }

    this.animation = snapshot.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 180, easing: 'cubic-bezier(0.19, 1, 0.22, 1)', fill: 'forwards',
    });
    this.animation.onfinish = () => this.cancel();
  }
}
