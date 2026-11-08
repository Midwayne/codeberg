import { expect, it } from 'vitest';

import { CHAT_SURFACE, clearOverlay, dismissScreen, openSurface, type AppSurface } from './app-surface';

const search: AppSurface = { screen: 'chat', overlay: 'search' };
const models: AppSurface = { screen: 'chat', overlay: 'models' };
const settings: AppSurface = { screen: 'settings', overlay: null };

it('opens settings or training as the only foreground', () => {
  expect(openSurface(search, 'settings')).toEqual(settings);
  expect(openSurface(models, 'training')).toEqual({ screen: 'training', overlay: null });
  expect(openSurface({ screen: 'settings', overlay: 'models' }, 'training')).toEqual({
    screen: 'training',
    overlay: null,
  });
});

it('toggles the active screen back to chat', () => {
  expect(openSurface(settings, 'settings')).toEqual(CHAT_SURFACE);
  expect(openSurface({ screen: 'training', overlay: null }, 'training')).toEqual(CHAT_SURFACE);
});

it('opens search on the chat screen and closes models', () => {
  expect(openSurface({ screen: 'settings', overlay: 'models' }, 'search')).toEqual(search);
  expect(openSurface(models, 'search')).toEqual(search);
  expect(openSurface(search, 'search')).toBe(search);
});

it('toggles models over the current screen and closes search', () => {
  expect(openSurface(settings, 'models')).toEqual({ screen: 'settings', overlay: 'models' });
  expect(openSurface(search, 'models')).toEqual(models);
  expect(openSurface(models, 'models')).toEqual(CHAT_SURFACE);
});

it('returns to chat from a schedule without closing search', () => {
  expect(openSurface(settings, 'chat')).toEqual(CHAT_SURFACE);
  expect(openSurface({ screen: 'training', overlay: null }, 'chat')).toEqual(CHAT_SURFACE);
  expect(openSurface(search, 'chat')).toBe(search);
  expect(openSurface(models, 'chat')).toEqual(CHAT_SURFACE);
  expect(openSurface({ screen: 'settings', overlay: 'models' }, 'chat')).toEqual(CHAT_SURFACE);
});

it('leaves a floating model dialog open when the settings screen itself closes', () => {
  const covered: AppSurface = { screen: 'settings', overlay: 'models' };

  expect(dismissScreen(covered)).toEqual(models);
  expect(dismissScreen(settings)).toEqual(CHAT_SURFACE);
  expect(dismissScreen(search)).toBe(search);
});

it('clears whichever overlay is up', () => {
  expect(clearOverlay(search)).toEqual(CHAT_SURFACE);
  expect(clearOverlay(models)).toEqual(CHAT_SURFACE);
  expect(clearOverlay(CHAT_SURFACE)).toBe(CHAT_SURFACE);
});
