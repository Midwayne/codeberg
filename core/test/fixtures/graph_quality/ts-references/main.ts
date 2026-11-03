import { save as persist } from './dep'; // imports:dep.ts
function register(callback: () => void) {} // target:register
export function run() {
  register(persist); // calls:register; references:save
  const callback = persist; // references:save
}
