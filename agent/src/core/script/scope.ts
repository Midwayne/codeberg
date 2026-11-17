import { AsyncLocalStorage } from 'node:async_hooks';

const scope = new AsyncLocalStorage<true>();

/** Run a script's tool call so it can be told apart from a direct call. */
export function inScript<T>(work: () => T): T {
  return scope.run(true, work);
}

/** True inside a script's tool call. Its results reach the model only through
 *  what the script prints, so they are not collected as answer evidence. */
export function insideScript(): boolean {
  return scope.getStore() === true;
}
