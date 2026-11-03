export class Base {
  save() {} // target:save
}
export class Child extends Base {
  run() {
    this.save(); // calls:save
  }
}
export class Other {
  save() {} // target:other
}
export function work(child: Child) {
  child.save(); // calls:save
}
