function save() {}
export function direct() {
  save();
}
export function shadow(save) {
  save();
}
export function hoisted() {
  save();
  const save = () => {};
}
