function save() {} // target:outer
export function outer() {
  function save() {} // target:inner
  save(); // calls:inner
}
export function other() {
  save(); // calls:outer
}
export function unknown(value: any) {
  value.save(); // calls:-
}
