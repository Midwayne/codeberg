export class User { // target:User
  save() {} // target:user_save
  run() {
    this.save(); // calls:user_save
  }
}
export class Cache { // target:Cache
  save() {} // target:cache_save
  run() {
    this.save(); // calls:cache_save
  }
}
export function work(user: User, cache: Cache) {
  user.save(); // calls:user_save
  cache.save(); // calls:cache_save
}
export function construct() {
  const user = new User(); // calls:User
  user.save(); // calls:user_save
}
