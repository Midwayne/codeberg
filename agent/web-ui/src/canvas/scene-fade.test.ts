import { afterEach, expect, it, vi } from 'vitest';
import { SceneFade } from './scene-fade';

afterEach(() => vi.unstubAllGlobals());

function setup({ reduced = false, hidden = false } = {}) {
  const frames = new Map<number, FrameRequestCallback>();
  let frame = 0;
  const snapshots: ReturnType<typeof makeSnapshot>[] = [];
  const parent = { append: vi.fn() };
  const source = { width: 1200, height: 800, style: { width: '600px', height: '400px' }, parentElement: parent };
  const query = vi.fn(() => source);
  const create = vi.fn(() => {
    const snapshot = makeSnapshot();
    snapshots.push(snapshot);

    return snapshot;
  });

  vi.stubGlobal('document', { hidden, createElement: create });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: reduced }) });
  vi.stubGlobal('getComputedStyle', () => ({ opacity: '0.4' }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frame, callback);

    return frame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));

  const fade = new SceneFade(() => ({ querySelector: query }) as unknown as HTMLElement);
  const tick = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  };

  return { fade, source, snapshots, frames, create, tick };
}

function makeSnapshot() {
  const context = { drawImage: vi.fn(), globalAlpha: 1 };
  const animation = { cancel: vi.fn(), onfinish: undefined as undefined | (() => void) };

  return { width: 0, height: 0, className: '', style: { width: '', height: '' }, context, animation,
    getContext: () => context, setAttribute: vi.fn(), remove: vi.fn(), animate: vi.fn(() => animation) };
}

it('reveals the new scene after render and releases the snapshot when finished', () => {
  const { fade, snapshots, source, tick } = setup();
  fade.capture();
  const snapshot = snapshots[0]!;

  expect(snapshot.context.drawImage).toHaveBeenCalledWith(source, 0, 0);
  expect(snapshot.width).toBe(source.width);
  expect(snapshot.style.width).toBe('600px');
  expect(snapshot.animate).not.toHaveBeenCalled();

  tick();
  tick();

  expect(snapshot.animate).toHaveBeenCalledWith([{ opacity: 1 }, { opacity: 0 }], expect.objectContaining({ duration: 180 }));
  snapshot.animation.onfinish!();

  expect(snapshot.remove).toHaveBeenCalledOnce();
  expect(snapshot.animation.cancel).toHaveBeenCalledOnce();
});

it('continues rapid updates from the visible blend and cancels obsolete frames', () => {
  const { fade, snapshots, frames, tick } = setup();
  fade.capture();
  tick();
  tick();
  fade.capture();
  const [first, second] = snapshots;

  expect(second!.context.globalAlpha).toBe(0.4);
  expect(second!.context.drawImage).toHaveBeenLastCalledWith(first, 0, 0, 1200, 800);
  expect(first!.animation.cancel).toHaveBeenCalledOnce();
  expect(first!.remove).toHaveBeenCalledOnce();

  fade.cancel();
  tick();

  expect(frames.size).toBe(0);
  expect(second!.animate).not.toHaveBeenCalled();
  expect(second!.remove).toHaveBeenCalledOnce();
});

it.each([{ reduced: true }, { hidden: true }])('skips pixel animation for %j', (preferences) => {
  const { fade, create } = setup(preferences);
  fade.capture();

  expect(create).not.toHaveBeenCalled();
});
