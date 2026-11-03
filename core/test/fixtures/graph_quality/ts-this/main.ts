export class User {
  save() {}
  run() {
    const arrow = () => this.save();
    function detached() {
      this.save();
    }
  }
}
