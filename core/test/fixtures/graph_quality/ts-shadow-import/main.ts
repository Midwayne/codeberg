import { save } from './dep'; // imports:dep.ts
export function run(save: () => void) {
  save(); // calls:-
}
export function other() {
  save(); // calls:imported
}
