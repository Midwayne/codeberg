import * as storage from './dep'; // imports:dep.ts
function save() {} // target:local_save
export function run() {
  storage.save(); // calls:dep_save
  save(); // calls:local_save
}
