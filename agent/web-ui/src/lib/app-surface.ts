export type AppScreen = 'chat' | 'settings' | 'training';

export type AppOverlay = 'models' | 'search' | null;

export type AppSurface = {
  screen: AppScreen;
  overlay: AppOverlay;
};

export type SurfaceTarget = AppScreen | 'models' | 'search';

export const CHAT_SURFACE: AppSurface = { screen: 'chat', overlay: null };

/**
 * One screen and at most one overlay.
 * Settings and training replace the chat and clear every overlay.
 * Search belongs to the chat, so opening it returns there.
 * Models floats over the current screen and replaces search.
 * Opening the active screen or models again closes it.
 * Search stays open until a different target asks for the foreground.
 * Opening chat keeps search and closes models.
 */
export function openSurface(current: AppSurface, target: SurfaceTarget): AppSurface {
  switch (target) {
    case 'chat':
      return withOverlay(current, 'chat', current.overlay === 'search' ? 'search' : null);
    case 'settings':
      return current.screen === 'settings' ? CHAT_SURFACE : { screen: 'settings', overlay: null };
    case 'training':
      return current.screen === 'training' ? CHAT_SURFACE : { screen: 'training', overlay: null };
    case 'models':
      return withOverlay(current, current.screen, current.overlay === 'models' ? null : 'models');
    case 'search':
      return withOverlay(current, 'chat', 'search');
    default: {
      const exhaustive: never = target;
      return exhaustive;
    }
  }
}

/** Leave settings or training. A model dialog that was floating over that screen stays. */
export function dismissScreen(current: AppSurface): AppSurface {
  if (current.screen === 'chat') return current;

  return { screen: 'chat', overlay: current.overlay };
}

export function clearOverlay(current: AppSurface): AppSurface {
  if (current.overlay === null) return current;

  return { screen: current.screen, overlay: null };
}

function withOverlay(current: AppSurface, screen: AppScreen, overlay: AppOverlay): AppSurface {
  if (current.screen === screen && current.overlay === overlay) return current;

  return { screen, overlay };
}
