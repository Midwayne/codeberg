import { User } from './dep';
export function run() {
  class User {
    static saveStatic() {}
    save() {}
  }
  const user: User = new User();
  user.save();
  User.saveStatic();
}
