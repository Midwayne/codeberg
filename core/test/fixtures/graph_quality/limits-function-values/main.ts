export function save() {} // target:save
const callback = save; // references:save
export function run() {
  callback(); // calls:save
}
