class User {
  fun save() {}
}
class Cache {
  fun save() {}
}
fun run(user: User, cache: Cache) {
  user.save()
  cache.save()
}
