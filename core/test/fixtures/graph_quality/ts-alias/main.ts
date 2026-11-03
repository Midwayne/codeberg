import { save as persist, load } from './dep'; // imports:dep.ts
export function run() {
  persist(); // calls:save
  load(); // calls:load
}
