export function outer(save) {
  function inner() {
    function save() {}
    save();
  }
  inner();
}
