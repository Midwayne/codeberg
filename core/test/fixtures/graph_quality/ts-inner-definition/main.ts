export function outer(save: () => void) {
  function inner() {
    function save() {}
    save();
  }
  inner();
}
