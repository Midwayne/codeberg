import type { CustomThemeId } from './theme-types';

export function isCustomThemeId(id: unknown): id is CustomThemeId {
  return typeof id === 'string' && /^custom-[a-z0-9-]{1,40}$/.test(id);
}

export function newCustomThemeId(): CustomThemeId {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
