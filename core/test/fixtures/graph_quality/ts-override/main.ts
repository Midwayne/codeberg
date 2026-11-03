export class Base {
  save() {}
}
export class Middle extends Base {
  save() {}
}
export class Child extends Middle {
  run() {
    this.save();
  }
}
export function work(child: Child) {
  child.save();
}
