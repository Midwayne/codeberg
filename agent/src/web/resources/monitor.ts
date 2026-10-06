import type { ResourceSettingsState } from './state.js';

export function start(state: ResourceSettingsState): void {
  state.monitor.start();
}

export function stop(state: ResourceSettingsState): void {
  state.monitor.stop();
}

export function usage(state: ResourceSettingsState, after = 0) {
  return state.monitor.read(after);
}
