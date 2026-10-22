import type { RefObject } from 'react';

type ScrollPosition = { top: number; height: number; viewport: number };

function position(element: HTMLElement): ScrollPosition {
  return { top: element.scrollTop, height: element.scrollHeight, viewport: element.clientHeight };
}

function nearBottom(value: ScrollPosition) {
  return value.height - value.top - value.viewport < 120;
}

/** Keep the user's intent across content growth, before new heights settle. */
export function createBottomFollower(element: HTMLElement, hold: RefObject<boolean>) {
  let previous = position(element);
  let following = nearBottom(previous);

  const sync = () => {
    if (!element.clientHeight) return;

    const current = position(element);
    const resized = current.height !== previous.height || current.viewport !== previous.viewport;
    if (hold.current || (!resized && current.top !== previous.top)) following = nearBottom(current);

    if (following && !hold.current) element.scrollTop = element.scrollHeight;

    previous = position(element);
  };

  const onScroll = () => {
    if (!element.clientHeight) return false;

    const current = position(element);
    const resized = current.height !== previous.height || current.viewport !== previous.viewport;

    if (hold.current || !resized) following = nearBottom(current);
    else if (!following && current.top > previous.top) {
      // Reaching the old bottom can reveal deferred markdown and move the bottom again.
      following = nearBottom(current) || current.top >= previous.height - previous.viewport - 120;
    }

    previous = current;

    return resized && following;
  };

  return { sync, onScroll };
}

export function observeChatBottom(element: HTMLElement, hold: RefObject<boolean>) {
  const follower = createBottomFollower(element, hold);
  let frame = 0;
  const schedule = () => {
    if (frame) return;

    frame = requestAnimationFrame(() => {
      frame = 0;
      follower.sync();
    });
  };
  const onScroll = () => {
    if (follower.onScroll()) schedule();
  };
  const observer = new ResizeObserver(schedule);

  observer.observe(element);
  if (element.firstElementChild) observer.observe(element.firstElementChild);

  element.addEventListener('scroll', onScroll, { passive: true });

  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    element.removeEventListener('scroll', onScroll);
  };
}
